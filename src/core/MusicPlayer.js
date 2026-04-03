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
      // Extract artist from "Artist - Title" format, or clean uploader name
      const artist = lastTrack.title.includes(' - ')
        ? lastTrack.title.slice(0, lastTrack.title.indexOf(' - ')).trim()
        : lastTrack.uploader.replace(/\s*-\s*Topic$/i, '').trim();

      // Extract core title keywords (strip artist prefix and parentheticals)
      const titleCore = lastTrack.title
        .replace(/^[^-]+-\s*/, '')                   // remove "Artist - " prefix
        .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')      // remove (stuff) [stuff]
        .trim();

      // Rotate search strategy for variety:
      // 0 → same artist (familiar), 1 → title keywords (cross-artist discovery)
      const strategy = Math.floor(Math.random() * 2);
      const query = strategy === 0 ? artist : (titleCore.length > 3 ? titleCore : artist);

      const results = await YouTube.search(query, 20);

      const queued = new Set(this.queue.map(t => t.url));

      // Strip parentheticals/brackets and lowercase for title comparison
      const normalize = t => t.toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim();

      // Exclude alternate versions of the same song
      const VERSION_RE = /\b(sped[\s-]up|slowed|reverb|nightcore|visualizer|lyrics?\s*video|official\s+lyric|official\s+audio|karaoke|instrumental|remix|cover|acoustic|live\s+at|extended|lofi|lo-fi|breakbeat|mashup|reaction)\b/i;

      const queuedNorm = this.queue.map(t => normalize(t.title));

      const pick = results.filter(r => {
        if (queued.has(r.url)) return false;
        if (VERSION_RE.test(r.title)) return false;
        const norm = normalize(r.title);
        // Skip if too similar to a title already in the queue
        return !queuedNorm.some(q => q === norm || q.includes(norm) || norm.includes(q));
      });

      if (!pick.length) { this._startInactivityTimer(); return; }

      const related = pick[Math.floor(Math.random() * pick.length)];
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