'use strict';

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { Readable } = require('stream');
const YouTube    = require('./YoutubeWrapper');
const Gemini     = require('./GeminiRecommender');
const DJAnnouncer = require('./DJAnnouncer');
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

class MusicPlayer {
  constructor(guildId) {
    this.guildId      = guildId;
    this.queue        = [];
    this.currentIndex = -1;
    this.isPlaying    = false;
    this.isPaused     = false;
    this.startTimestamp = null;
    this.pausedAt       = null;
    this.autoplay         = false;
    this.voiceConnection  = null;
    this._currentProcess  = null;
    this._inactivityTimer = null;
    this._textChannel     = null;
    this._prefetching     = false;   // prevents concurrent Gemini fetches
    this.djAnnounce       = null;    // { enabled, language } or null
    this._djIntroPlaying  = false;   // true while TTS intro is playing
    this._pendingNextIdx  = null;    // queue index to play after TTS finishes

    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this._clearInactivityTimer();
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (!this.isPlaying) return;

      // TTS intro just finished — immediately start the actual song
      if (this._djIntroPlaying) {
        this._djIntroPlaying = false;
        const idx = this._pendingNextIdx;
        this._pendingNextIdx = null;
        this.currentIndex = idx;
        this.play().then(() => {
          const track = this.getCurrentTrack();
          if (track && this._textChannel) {
            const content = track.isAutoplay ? '🔀 **Autoplay** — playing a related song' : undefined;
            this._textChannel.send({ embeds: [nowPlayingEmbed(track, 0)], content }).catch(() => {});
          }
        });
        if (this.autoplay) this._replenishAutoplay();
        return;
      }

      this._onTrackEnd();
    });

    this.audioPlayer.on('error', err => {
      console.error(`[MusicPlayer:${this.guildId}] AudioPlayer error:`, err.message);
      this._onTrackEnd(true);
    });
  }

  connect(voiceChannel) {
    if (
      this.voiceConnection &&
      this.voiceConnection.state.status !== VoiceConnectionStatus.Destroyed
    ) return this.voiceConnection;

    const conn = joinVoiceChannel({
      channelId:      voiceChannel.id,
      guildId:        voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:       true,
    });

    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });

    conn.subscribe(this.audioPlayer);
    this.voiceConnection = conn;
    return conn;
  }

  setTextChannel(channel) { this._textChannel = channel; }

  enqueue(track) {
    this.queue.push(track);
    return this.queue.length;
  }

  /**
   * Insert a user-requested track ahead of any queued autoplay tracks.
   * If autoplay songs are waiting, the user's song plays before them.
   * Returns the 1-based queue position where the track was inserted.
   */
  priorityEnqueue(track) {
    const firstAutoplay = this.queue.findIndex(
      (t, i) => i > this.currentIndex && t.isAutoplay
    );
    if (firstAutoplay !== -1) {
      this.queue.splice(firstAutoplay, 0, track);
      return firstAutoplay + 1;
    }
    this.queue.push(track);
    return this.queue.length;
  }

  async play(trackOverride) {
    const track = trackOverride || this.queue[this.currentIndex];
    if (!track) return;

    this._killCurrentProcess();

    try {
      const { stream, type, kill } = await YouTube.createAudioStream(track.url);
      this._currentProcess = { kill };

      const resource = createAudioResource(stream, {
        inputType:    type,
        inlineVolume: true,
        metadata:     { track },
      });
      resource.volume?.setVolume(0.5);

      this.audioPlayer.play(resource);
      this.startTimestamp = Date.now();
      this.isPlaying  = true;
      this.isPaused   = false;
      this.pausedAt   = null;
    } catch (err) {
      console.error(`[MusicPlayer:${this.guildId}] play error:`, err.message);
      this._onTrackEnd(true);
    }
  }

  skip() {
    this._killCurrentProcess();
    this.audioPlayer.stop(true);
  }

  async previous() {
    if (this.currentIndex <= 0) return false;
    this.currentIndex--;
    this._killCurrentProcess();
    this.audioPlayer.stop(true);
    await this.play();
    return true;
  }

  async jump(oneBased) {
    const idx = oneBased - 1;
    if (idx < 0 || idx >= this.queue.length) return false;
    this.currentIndex = idx;
    this._killCurrentProcess();
    this.audioPlayer.stop(true);
    await this.play();
    return true;
  }

  pause() {
    if (this.isPaused || !this.isPlaying) return false;
    this.audioPlayer.pause();
    this.isPaused = true;
    this.pausedAt = Date.now();
    return true;
  }

  resume() {
    if (!this.isPaused) return false;
    this.audioPlayer.unpause();
    if (this.pausedAt && this.startTimestamp) {
      this.startTimestamp += Date.now() - this.pausedAt;
    }
    this.isPaused = false;
    this.pausedAt = null;
    return true;
  }

  remove(oneBased) {
    const idx = oneBased - 1;
    if (idx < 0 || idx >= this.queue.length) return null;
    const [removed] = this.queue.splice(idx, 1);
    if (idx < this.currentIndex) {
      this.currentIndex--;
    } else if (idx === this.currentIndex) {
      this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
      if (this.queue.length > 0) {
        this._killCurrentProcess();
        this.audioPlayer.stop(true);
      } else {
        this.destroy();
      }
    }
    return removed;
  }

  destroy() {
    this._clearInactivityTimer();
    this._killCurrentProcess();
    this.isPlaying    = false;
    this.isPaused     = false;
    this.currentIndex = -1;
    try { this.audioPlayer.stop(true); }      catch {}
    try { this.voiceConnection?.destroy(); }  catch {}
    this.voiceConnection = null;
  }

  getElapsed() {
    if (!this.startTimestamp) return 0;
    if (this.isPaused && this.pausedAt) return Math.floor((this.pausedAt - this.startTimestamp) / 1000);
    return Math.floor((Date.now() - this.startTimestamp) / 1000);
  }

  getCurrentTrack() { return this.queue[this.currentIndex] || null; }

  _onTrackEnd(error = false) {
    if (error) {
      this._sendError(`Failed to play **${this.getCurrentTrack()?.title || 'unknown track'}**. Skipping.`);
    }

    const next = this.currentIndex + 1;
    if (next < this.queue.length) {
      const nextTrack = this.queue[next];
      if (this.djAnnounce?.enabled) {
        // Play TTS intro first; Idle handler takes over when it finishes
        this._playWithAnnounce(next, nextTrack);
      } else {
        this.currentIndex = next;
        this.play().then(() => {
          const track = this.getCurrentTrack();
          if (track && this._textChannel) {
            const content = track.isAutoplay ? '🔀 **Autoplay** — playing a related song' : undefined;
            this._textChannel.send({ embeds: [nowPlayingEmbed(track, 0)], content }).catch(() => {});
          }
        });
      }
      // Replenish autoplay queue in background before it runs dry
      if (this.autoplay) this._replenishAutoplay();
    } else if (this.autoplay) {
      // Queue ran out — pre-fetch should prevent this, but handle gracefully
      this._prefetchAutoplay(3).then(() => {
        const nextAfterFetch = this.currentIndex + 1;
        if (nextAfterFetch < this.queue.length) {
          this.currentIndex = nextAfterFetch;
          this.play().then(() => {
            const track = this.getCurrentTrack();
            if (track && this._textChannel) {
              this._textChannel.send({
                embeds:  [nowPlayingEmbed(track, 0)],
                content: '🔀 **Autoplay** — playing a related song',
              }).catch(() => {});
            }
          });
        } else {
          this.isPlaying = false;
          this._startInactivityTimer();
        }
      }).catch(() => {
        this.isPlaying = false;
        this._startInactivityTimer();
      });
    } else {
      this.isPlaying    = false;
      this.currentIndex = this.queue.length > 0 ? this.queue.length - 1 : -1;
      this._startInactivityTimer();
    }
  }

  /**
   * Check remaining autoplay tracks in the queue and fetch more if running low.
   * Called after every track ends while autoplay is on.
   */
  _replenishAutoplay() {
    const remaining = this.queue
      .slice(this.currentIndex + 1)
      .filter(t => t.isAutoplay).length;

    if (remaining <= 1) {
      this._prefetchAutoplay(3).catch(() => {});
    }
  }

  /**
   * Ask Gemini for `count` song recommendations, resolve each to a YouTube
   * result, tag them isAutoplay=true, and push them onto the queue.
   * Falls back to an artist text search if Gemini returns nothing.
   * @param {number} count
   */
  async _prefetchAutoplay(count = 3) {
    if (this._prefetching) return;
    this._prefetching = true;

    try {
      const seedTrack  = this.getCurrentTrack() || this.queue[this.queue.length - 1];
      if (!seedTrack) return;

      const history    = this.queue.slice(-10);
      const historySet = new Set(this.queue.map(t => t.url));
      const LIVE_RE    = /\b(live\s+at|live\s+from|concert|acoustic|remix|cover|sped.?up|slowed|karaoke|instrumental|nightcore|reverb|visualizer|mashup|lofi|lo-fi|8d)\b/i;

      // ── Primary: Gemini batch ────────────────────────────────────────────────
      const recs = await Gemini.recommendBatch(seedTrack, history, count);

      for (const rec of recs) {
        try {
          const result = await YouTube.findBestTrack(`${rec.artist} ${rec.title}`);
          if (result && !historySet.has(result.url) && !LIVE_RE.test(result.title)) {
            this.queue.push({ ...result, requestedBy: 'Autoplay', isAutoplay: true });
            historySet.add(result.url);
          }
        } catch { /* skip failed individual lookups */ }
      }

      // ── Fallback: artist text search ─────────────────────────────────────────
      const added = this.queue.filter(t => t.isAutoplay).length;
      if (added === 0) {
        console.log(`[Autoplay:${this.guildId}] Gemini empty — falling back to artist search`);
        const artist = seedTrack.title.includes(' - ')
          ? seedTrack.title.slice(0, seedTrack.title.indexOf(' - ')).trim()
          : seedTrack.uploader.replace(/\s*-\s*Topic$/i, '').trim();

        const NON_MUSIC_RE = /\b(episode|interview|news|documentary|podcast|full\s+album|compilation|reaction|review|vlog|highlights|trailer|report)\b/i;
        const seedDur      = seedTrack.duration || 210;

        const results = await YouTube.search(`${artist} best songs`, 15);
        const picks   = results.filter(r =>
          !historySet.has(r.url) && !LIVE_RE.test(r.title) && !NON_MUSIC_RE.test(r.title) &&
          r.duration >= 90 && r.duration <= Math.min(480, seedDur + 120)
        ).slice(0, count);

        for (const pick of picks) {
          this.queue.push({ ...pick, requestedBy: 'Autoplay', isAutoplay: true });
        }
      }
    } catch (err) {
      console.error(`[MusicPlayer:${this.guildId}] prefetch error:`, err.message);
    } finally {
      this._prefetching = false;
    }
  }

  /**
   * Generate a TTS intro for nextTrack and play it in the voice channel.
   * The Idle handler will detect _djIntroPlaying and immediately start the
   * actual song when TTS finishes — no gap between announcement and music.
   * Falls back to playing the song directly if TTS generation fails.
   */
  async _playWithAnnounce(nextIndex, nextTrack) {
    let audioBuffer = null;
    try {
      audioBuffer = await DJAnnouncer.announce(nextTrack, this.djAnnounce.language);
    } catch { /* non-fatal — fall through to direct play */ }

    if (audioBuffer) {
      this._pendingNextIdx = nextIndex;
      this._djIntroPlaying = true;

      // Wrap buffer in a Readable stream; @discordjs/voice pipes it through ffmpeg
      const stream   = Readable.from([audioBuffer]);
      const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
      this.audioPlayer.play(resource);
      // Idle handler takes over from here
    } else {
      // TTS failed — skip intro and play song immediately
      this.currentIndex = nextIndex;
      await this.play();
      const track = this.getCurrentTrack();
      if (track && this._textChannel) {
        const content = track.isAutoplay ? '🔀 **Autoplay** — playing a related song' : undefined;
        this._textChannel.send({ embeds: [nowPlayingEmbed(track, 0)], content }).catch(() => {});
      }
    }
  }

  _killCurrentProcess() {
    try { this._currentProcess?.kill(); } catch {}
    this._currentProcess = null;
  }

  _startInactivityTimer() {
    this._clearInactivityTimer();
    this._inactivityTimer = setTimeout(() => {
      if (!this.isPlaying) {
        if (this._textChannel) {
          this._textChannel.send({
            embeds: [{ description: '👋 Left the voice channel due to inactivity.', color: 0xFEE75C }],
          }).catch(() => {});
        }
        this.destroy();
        this.emit?.('destroyed');
      }
    }, INACTIVITY_TIMEOUT_MS);
  }

  _clearInactivityTimer() {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
  }

  _sendError(message) {
    this._textChannel?.send({ embeds: [errorEmbed(message)] }).catch(() => {});
  }
}

module.exports = MusicPlayer;