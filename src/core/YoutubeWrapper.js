'use strict';

const { spawn }    = require('child_process');
const { Readable } = require('stream');
const { StreamType } = require('@discordjs/voice');
const fs   = require('fs');
const path = require('path');

const FFMPEG       = process.env.FFMPEG_PATH || 'ffmpeg';
const COOKIES_FILE = path.join('/tmp', 'yt-cookies.txt');

let yt = null; // Innertube client

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
 * Initialize Innertube client. Call once at startup.
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

  // youtubei.js is ESM — use dynamic import
  const { Innertube } = await import('youtubei.js');

  const opts = {};
  if (fs.existsSync(COOKIES_FILE)) {
    opts.cookie = parseCookieFile(COOKIES_FILE);
  }

  yt = await Innertube.create(opts);
  console.log('[YouTube] Innertube client ready.');
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
 * Create a PCM audio stream for a YouTube URL via Innertube + FFmpeg.
 * Returns { stream, type, kill }.
 * @param {string} url
 */
async function createAudioStream(url) {
  const id   = extractId(url);
  const info = await yt.getInfo(id);
  console.log(`[YouTube] Streaming: ${info.basic_info.title}`);

  // download() handles format selection and deciphering internally
  const rawStream = await info.download({ type: 'audio', quality: 'best' });

  // youtubei.js returns a Web ReadableStream — convert to Node.js Readable
  const ytStream = Readable.fromWeb(rawStream);

  // Pipe through FFmpeg for PCM output
  const ffmpeg = spawn(FFMPEG, [
    '-i',  'pipe:0',
    '-vn',
    '-f',  's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ytStream.pipe(ffmpeg.stdin);

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
      try { ytStream.destroy(); }   catch {}
      try { ffmpeg.kill('SIGKILL'); } catch {}
    },
  };
}

function extractId(url) {
  const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return m ? m[1] : url;
}

module.exports = { init, search, getVideoInfo, createAudioStream };
