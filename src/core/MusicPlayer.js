'use strict';

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const YouTube = require('./YoutubeWrapper');
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

    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this._clearInactivityTimer();
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (!this.isPlaying) return;
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
      this.currentIndex = next;
      this.play().then(() => {
        const track = this.getCurrentTrack();
        if (track && this._textChannel) {
          this._textChannel.send({ embeds: [nowPlayingEmbed(track, 0)] }).catch(() => {});
        }
      });
    } else if (this.autoplay) {
      this._fetchAndPlayRelated();
    } else {
      this.isPlaying    = false;
      this.currentIndex = this.queue.length > 0 ? this.queue.length - 1 : -1;
      this._startInactivityTimer();
    }
  }

  async _fetchAndPlayRelated() {
    const lastTrack = this.queue[this.queue.length - 1];
    if (!lastTrack) { this._startInactivityTimer(); return; }

    try {
      // ── Step 1: Candidate Pool ───────────────────────────────────────────────
      // Use YouTube's own "Up Next" list (collaborative filtering already applied).
      // This is far more accurate than any text-search heuristic.
      const candidates = await YouTube.getRelatedVideos(lastTrack.url);

      // ── Step 2: Strict Filter ────────────────────────────────────────────────
      const VERSION_TAGS = [
        'live', 'cover', 'acoustic', 'reggae', 'remix', 'karaoke',
        'instrumental', 'sped.?up', 'slowed', '8d', 'lofi', 'lo-fi',
        'nightcore', 'reverb', 'visualizer', 'mashup',
      ];

      // If the seed song itself contains a tag, allow that tag in candidates
      // (e.g. user played an acoustic version → autoplay can queue another acoustic)
      const seedTagsAllowed = new Set(
        VERSION_TAGS.filter(tag => new RegExp(`\\b${tag}\\b`, 'i').test(lastTrack.title))
      );
      const blockedTags = VERSION_TAGS.filter(t => !seedTagsAllowed.has(t));
      const VERSION_RE  = new RegExp(`\\b(${blockedTags.join('|')})\\b`, 'i');

      const NON_MUSIC_RE = /\b(episode|ep\.\s*\d|interview|news|documentary|podcast|full\s+album|compilation|reaction|review|vlog|highlights|trailer|behind\s+the\s+scenes|report|talk\s+show)\b/i;

      // Duration gate: within ±2 min of seed, AND must be between 1:30 – 8:00
      const seedDur  = lastTrack.duration || 210;
      const MIN_DUR  = Math.max(90,  seedDur - 120);
      const MAX_DUR  = Math.min(480, seedDur + 120);

      const history = new Set(this.queue.map(t => t.url));

      const filtered = candidates.filter(r => {
        if (history.has(r.url))           return false; // already queued / played
        if (VERSION_RE.test(r.title))     return false; // blocked version type
        if (NON_MUSIC_RE.test(r.title))   return false; // non-music content
        if (r.duration < MIN_DUR || r.duration > MAX_DUR) return false; // wrong length
        if (r.viewCount > 0 && r.viewCount < 100_000)     return false; // too obscure
        return true;
      });

      if (!filtered.length) { this._startInactivityTimer(); return; }

      // ── Step 3: Score & Select ───────────────────────────────────────────────
      const seedArtist = lastTrack.uploader.replace(/\s*-\s*Topic$/i, '').trim().toLowerCase();

      const score = r => {
        let s = 0;
        const u = r.uploader;
        const ul = u.toLowerCase();
        const tl = r.title.toLowerCase();

        // Official channel bonus
        if (/vevo$/i.test(u) || /official/i.test(u))              s += 30;
        // Same artist bonus
        if (ul.replace(/\s*-\s*topic$/i, '').trim() === seedArtist) s += 20;
        // Prefer clean audio/lyric uploads (no intros)
        if (/\b(lyric[s]?|official\s+audio)\b/i.test(tl))         s += 10;
        // Slight penalty for MVs (may have story intro)
        if (/\b(official\s+)?(music\s+)?video\b|\bmv\b/i.test(tl)) s -=  5;

        return s;
      };

      // Pick randomly from top 3 to stay varied without sacrificing quality
      const top = filtered
        .map(r => ({ r, s: score(r) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);

      const related = top[Math.floor(Math.random() * top.length)].r;
      const track   = { ...related, requestedBy: 'Autoplay' };

      this.queue.push(track);
      this.currentIndex = this.queue.length - 1;

      await this.play();

      if (this._textChannel) {
        this._textChannel.send({
          embeds:  [nowPlayingEmbed(track, 0)],
          content: '🔀 **Autoplay** — playing a related song',
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`[MusicPlayer:${this.guildId}] autoplay error:`, err.message);
      this._startInactivityTimer();
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