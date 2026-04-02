'use strict';

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const YtDlp = require('./YtDlpWrapper');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class MusicPlayer {
  /**
   * @param {string} guildId
   */
  constructor(guildId) {
    this.guildId     = guildId;
    this.queue       = [];      // Track[]
    this.currentIndex = -1;    // 0-based; -1 = nothing playing
    this.isPlaying   = false;
    this.isPaused    = false;

    // Timestamps for /nowplaying progress bar
    this.startTimestamp = null; // epoch ms of effective playback start (adjusted for pauses)
    this.pausedAt       = null; // epoch ms when paused

    this.autoplay         = false; // autoplay toggle
    this.voiceConnection  = null;
    this._currentProcess  = null; // yt-dlp spawn handle
    this._inactivityTimer = null;
    this._textChannel     = null; // for auto-advance announcements

    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this._clearInactivityTimer();
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (!this.isPlaying) return; // already cleaned up
      this._onTrackEnd();
    });

    this.audioPlayer.on('error', err => {
      console.error(`[MusicPlayer:${this.guildId}] AudioPlayer error:`, err.message);
      this._onTrackEnd(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Voice connection
  // ---------------------------------------------------------------------------

  /**
   * Join a voice channel (or reuse existing connection).
   * @param {import('discord.js').VoiceBasedChannel} voiceChannel
   */
  connect(voiceChannel) {
    if (
      this.voiceConnection &&
      this.voiceConnection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      return this.voiceConnection;
    }

    const conn = joinVoiceChannel({
      channelId:        voiceChannel.id,
      guildId:          voiceChannel.guild.id,
      adapterCreator:   voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:         true,
    });

    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Discord may briefly disconnect during region switches — wait to reconnect
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

  setTextChannel(channel) {
    this._textChannel = channel;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  /**
   * Add a track to the queue.
   * @param {object} track
   * @returns {number} 1-based queue position
   */
  enqueue(track) {
    this.queue.push(track);
    return this.queue.length;
  }

  /**
   * Start playback from currentIndex. Resolves when audio starts.
   * @param {object} [trackOverride]  if provided, play this track without touching queue
   */
  async play(trackOverride) {
    const track = trackOverride || this.queue[this.currentIndex];
    if (!track) return;

    this._killCurrentProcess();

    try {
      // Step 1: yt-dlp pipes raw audio to stdout
      const ytdlp = YtDlp.createAudioStream(track.url);
      ytdlp.stderr.on('data', d => console.error(`[ytdlp] ${d.toString().trim()}`));
      ytdlp.on('close', code => { if (code !== 0) console.error(`[ytdlp] exited with code ${code}`); });

      // Step 2: FFmpeg reads from stdin, outputs PCM to stdout
      const ffmpeg = spawn(FFMPEG, [
        '-i',  'pipe:0',
        '-vn',
        '-f',  's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      ffmpeg.stderr.on('data', d => console.error(`[ffmpeg] ${d.toString().trim()}`));
      ffmpeg.on('close', code => { if (code !== 0) console.error(`[ffmpeg] exited with code ${code}`); });

      ytdlp.stdout.pipe(ffmpeg.stdin);

      // Kill both processes together
      this._currentProcess = {
        kill: () => { try { ytdlp.kill('SIGKILL'); } catch {} try { ffmpeg.kill('SIGKILL'); } catch {} },
      };

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType:    StreamType.Raw,
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
    // _onTrackEnd will be called by the Idle event handler
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
    // Shift startTimestamp forward by the paused duration so elapsed stays correct
    if (this.pausedAt && this.startTimestamp) {
      this.startTimestamp += Date.now() - this.pausedAt;
    }
    this.isPaused = false;
    this.pausedAt = null;
    return true;
  }

  /**
   * Remove a track by 1-based position.
   * @param {number} oneBased
   * @returns {object|null} removed track
   */
  remove(oneBased) {
    const idx = oneBased - 1;
    if (idx < 0 || idx >= this.queue.length) return null;

    const [removed] = this.queue.splice(idx, 1);

    if (idx < this.currentIndex) {
      // Track before current was removed — keep playing the same song
      this.currentIndex--;
    } else if (idx === this.currentIndex) {
      // Currently playing track was removed — skip
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
    try { this.audioPlayer.stop(true); } catch { /* ignore */ }
    try { this.voiceConnection?.destroy(); } catch { /* ignore */ }
    this.voiceConnection = null;
  }

  // ---------------------------------------------------------------------------
  // Progress helpers
  // ---------------------------------------------------------------------------

  /**
   * Elapsed playback seconds for the current track.
   * @returns {number}
   */
  getElapsed() {
    if (!this.startTimestamp) return 0;
    if (this.isPaused && this.pausedAt) return Math.floor((this.pausedAt - this.startTimestamp) / 1000);
    return Math.floor((Date.now() - this.startTimestamp) / 1000);
  }

  getCurrentTrack() {
    return this.queue[this.currentIndex] || null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

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
      // Queue exhausted — fetch a related song and keep going
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
      // Search for songs similar to the last track
      const query   = `${lastTrack.title} ${lastTrack.uploader}`;
      const results = await YtDlp.search(query, 10);

      // Exclude URLs already in the queue to avoid repeats
      const queued  = new Set(this.queue.map(t => t.url));
      const pick    = results.filter(r => !queued.has(r.url));

      if (!pick.length) { this._startInactivityTimer(); return; }

      // Pick a random result from the filtered list
      const related = pick[Math.floor(Math.random() * pick.length)];
      const track   = { ...related, requestedBy: 'Autoplay' };

      this.queue.push(track);
      this.currentIndex = this.queue.length - 1;

      await this.play();

      if (this._textChannel) {
        const { nowPlayingEmbed } = require('../utils/embeds');
        this._textChannel.send({
          embeds: [nowPlayingEmbed(track, 0)],
          content: '🔀 **Autoplay** — playing a related song',
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`[MusicPlayer:${this.guildId}] autoplay error:`, err.message);
      this._startInactivityTimer();
    }
  }

  _killCurrentProcess() {
    try { this._currentProcess?.kill(); } catch { /* ignore */ }
    this._currentProcess = null;
  }

  _startInactivityTimer() {
    this._clearInactivityTimer();
    this._inactivityTimer = setTimeout(() => {
      if (!this.isPlaying) {
        if (this._textChannel) {
          this._textChannel.send({ embeds: [{ description: '👋 Left the voice channel due to inactivity.', color: 0xFEE75C }] }).catch(() => {});
        }
        this.destroy();
        // Signal PlayerManager to remove this guild
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
