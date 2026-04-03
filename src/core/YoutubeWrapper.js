'use strict';

const { spawn }      = require('child_process');
const { StreamType } = require('@discordjs/voice');
const playdl         = require('play-dl');
const fs             = require('fs');
const path           = require('path');

const FFMPEG       = process.env.FFMPEG_PATH || 'ffmpeg';
const COOKIES_FILE = path.join('/tmp', 'yt-cookies.txt');

let yt = null; // Innertube client (search / info only)

/**
 * Parse Netscape cookies.txt into a Cookie header string.
 */
function parseCookieFile(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => !l.startsWith('#') && l.includes('\t'))
    .map(l => {
      const parts = l.split('\t');
      return parts.length >= 7 ? `${parts[5]}=${parts[6].trim()}` : null;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Initialize clients. Call once at startup.
 */
async function init() {
  if (process.env.YOUTUBE_COOKIES) {
    try {
      fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
      console.log('[YouTube] Cookies file written.');
    } catch (e) {
      console.error('[YouTube] Failed to write cookies:', e.message);
    }
  }

  // Set cookies for play-dl (streaming)
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      await playdl.setToken({ youtube: { cookie: parseCookieFile(COOKIES_FILE) } });
      console.log('[YouTube] play-dl cookies set.');
    } catch (e) {
      console.error('[YouTube] Failed to set play-dl cookies:', e.message);
    }
  }

  // youtubei.js is ESM — use dynamic import (search / info)
  const { Innertube } = await import('youtubei.js');
  const opts = {};
  if (fs.existsSync(COOKIES_FILE)) {
    opts.cookie = parseCookieFile(COOKIES_FILE);
  }
  yt = await Innertube.create(opts);
  console.log('[YouTube] Ready.');
}

/**
 * Search YouTube for videos.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
async function search(query, limit = 5) {
  const results = await yt.search(query, { type: 'video' });
  return (results.videos || []).slice(0, limit).map(v => ({
    title:     v.title?.text      || 'Unknown Title',
    url:       `https://www.youtube.com/watch?v=${v.id}`,
    duration:  v.duration?.seconds ?? 0,
    thumbnail: v.thumbnails?.[0]?.url || null,
    uploader:  v.author?.name    || 'Unknown',
  }));
}

/**
 * Fetch metadata for a single YouTube URL.
 * @param {string} url
 * @returns {Promise<Track>}
 */
async function getVideoInfo(url) {
  const id   = extractId(url);
  const info = await yt.getBasicInfo(id);
  const v    = info.basic_info;
  return {
    title:     v.title          || 'Unknown Title',
    url:       `https://www.youtube.com/watch?v=${v.id}`,
    duration:  v.duration       || 0,
    thumbnail: v.thumbnail?.[0]?.url || null,
    uploader:  v.channel?.name  || 'Unknown',
  };
}

/**
 * Create an audio stream for a YouTube URL via play-dl.
 * Returns { stream, type, kill }.
 * @param {string} url
 */
async function createAudioStream(url) {
  // Use video_info to get title for logging, then stream directly
  let title = url;
  try {
    const info = await playdl.video_info(url);
    title = info.video_details.title ?? url;
  } catch { /* non-fatal */ }

  console.log(`[YouTube] Streaming: ${title}`);

  const pdStream = await playdl.stream(url, { quality: 2 });
  console.log(`[YouTube] Stream type: ${pdStream.type}`);

  // OggOpus / WebmOpus — Discord can decode natively, no FFmpeg needed
  if (pdStream.type === 'ogg/opus') {
    return {
      stream: pdStream.stream,
      type:   StreamType.OggOpus,
      kill:   () => { try { pdStream.stream.destroy(); } catch {} },
    };
  }

  if (pdStream.type === 'webm/opus') {
    return {
      stream: pdStream.stream,
      type:   StreamType.WebmOpus,
      kill:   () => { try { pdStream.stream.destroy(); } catch {} },
    };
  }

  // Fallback: pipe arbitrary stream through FFmpeg → PCM
  const ffmpeg = spawn(FFMPEG, [
    '-i',  'pipe:0',
    '-vn',
    '-f',  's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  pdStream.stream.pipe(ffmpeg.stdin);
  pdStream.stream.on('error', () => { try { ffmpeg.kill('SIGKILL'); } catch {} });

  ffmpeg.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (msg && !msg.startsWith('frame=') && !msg.startsWith('size=')) {
      console.error(`[ffmpeg] ${msg}`);
    }
  });

  return {
    stream: ffmpeg.stdout,
    type:   StreamType.Raw,
    kill:   () => {
      try { pdStream.stream.destroy(); } catch {}
      try { ffmpeg.kill('SIGKILL'); }    catch {}
    },
  };
}

function extractId(url) {
  const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return m ? m[1] : url;
}

module.exports = { init, search, getVideoInfo, createAudioStream };
