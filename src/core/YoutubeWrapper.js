'use strict';

const play = require('play-dl');
const fs   = require('fs');
const path = require('path');

const COOKIES_FILE = path.join('/tmp', 'yt-cookies.txt');

/**
 * Parse a Netscape-format cookies.txt into a cookie header string for play-dl.
 * @param {string} filePath
 * @returns {string}
 */
function parseCookieFile(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => !l.startsWith('#') && l.trim().length > 0)
    .map(l => {
      const parts = l.split('\t');
      if (parts.length >= 7) return `${parts[5]}=${parts[6].trim()}`;
      return null;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Initialize play-dl auth from the YOUTUBE_COOKIES env var.
 * Call once at startup.
 */
async function init() {
  // Write cookies file from env var
  if (process.env.YOUTUBE_COOKIES) {
    try {
      fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
      console.log('[YouTube] Cookies file written.');
    } catch (e) {
      console.error('[YouTube] Failed to write cookies file:', e.message);
    }
  }

  // Set play-dl token from cookies
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookie = parseCookieFile(COOKIES_FILE);
      await play.setToken({ youtube: { cookie } });
      console.log('[YouTube] Cookie token set for play-dl.');
    } catch (e) {
      console.error('[YouTube] Failed to set play-dl cookie token:', e.message);
    }
  }
}

/**
 * Search YouTube and return up to `limit` results.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
async function search(query, limit = 5) {
  const results = await play.search(query, {
    source: { youtube: 'video' },
    limit,
  });

  return results.map(v => ({
    title:     v.title    || 'Unknown Title',
    url:       v.url,
    duration:  v.durationInSec || 0,
    thumbnail: v.thumbnails?.[0]?.url || null,
    uploader:  v.channel?.name || 'Unknown',
  }));
}

/**
 * Fetch metadata for a single YouTube URL.
 * @param {string} url
 * @returns {Promise<Track>}
 */
async function getVideoInfo(url) {
  const info = await play.video_info(url);
  const v    = info.video_details;
  return {
    title:     v.title    || 'Unknown Title',
    url:       v.url,
    duration:  v.durationInSec || 0,
    thumbnail: v.thumbnails?.[0]?.url || null,
    uploader:  v.channel?.name || 'Unknown',
  };
}

/**
 * Create an audio stream for a YouTube URL.
 * Returns { stream, type } for createAudioResource.
 * @param {string} url
 */
async function createAudioStream(url) {
  const validated = await play.validate(url);
  console.log(`[YouTube] stream url="${url}" validate="${validated}"`);
  if (validated !== 'yt_video') throw new Error(`Invalid URL (type: ${validated}) — ${url}`);

  // Test video_info first to see if auth/cookies work
  try {
    const info = await play.video_info(url);
    console.log(`[YouTube] video_info OK: "${info.video_details.title}", formats: ${info.format?.length ?? 0}`);
  } catch (err) {
    console.error(`[YouTube] video_info failed: ${err.message}`);
    throw err;
  }

  try {
    return await play.stream(url);
  } catch (err) {
    console.error(`[YouTube] play.stream failed: ${err.message}`);
    console.error(err.stack);
    throw err;
  }
}

module.exports = { init, search, getVideoInfo, createAudioStream };
