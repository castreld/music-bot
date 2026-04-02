const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const YT_DLP      = process.env.YT_DLP_PATH || 'yt-dlp';
const COOKIES_FILE = path.join('/tmp', 'yt-cookies.txt');

// Write YouTube cookies from env var to disk once on startup
if (process.env.YOUTUBE_COOKIES) {
  try {
    fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
    console.log('[YtDlp] Cookies file written.');
  } catch (e) {
    console.error('[YtDlp] Failed to write cookies file:', e.message);
  }
}

/**
 * Returns extra args to append to every yt-dlp call.
 * Always uses iOS player client to reduce bot detection.
 * Adds cookies if available.
 * @returns {string[]}
 */
function extraArgs() {
  const args = ['--extractor-args', 'youtube:player_client=ios,web'];
  if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
  return args;
}

/**
 * Run a yt-dlp command and collect stdout/stderr.
 * @param {string[]} args
 * @returns {Promise<string>} stdout
 */
function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', err => reject(new Error(`yt-dlp not found: ${err.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      resolve(stdout);
    });
  });
}

/**
 * Search YouTube and return up to `limit` results.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
async function search(query, limit = 5) {
  const raw = await run([
    `ytsearch${limit}:${query}`,
    '--dump-json',
    '--flat-playlist',
    '--no-playlist',
    '--no-warnings',
    ...extraArgs(),
  ]);

  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const item = JSON.parse(line);
      return {
        title: item.title || 'Unknown Title',
        url: item.url || item.webpage_url,
        duration: item.duration || 0,
        thumbnail: item.thumbnail || null,
        uploader: item.uploader || item.channel || 'Unknown',
      };
    });
}

/**
 * Fetch metadata for a single video URL.
 * @param {string} url
 * @returns {Promise<Track>}
 */
async function getVideoInfo(url) {
  const raw = await run([
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    ...extraArgs(),
    url,
  ]);

  const item = JSON.parse(raw.trim());
  return {
    title: item.title || 'Unknown Title',
    url: item.webpage_url || url,
    duration: item.duration || 0,
    thumbnail: item.thumbnail || null,
    uploader: item.uploader || item.channel || 'Unknown',
  };
}

/**
 * Get the direct audio stream URL for a video (no download).
 * @param {string} url
 * @returns {Promise<string>}
 */
async function getStreamUrl(url) {
  const raw = await run([
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-g',
    ...extraArgs(),
    url,
  ]);
  return raw.trim().split('\n')[0];
}

module.exports = { search, getVideoInfo, getStreamUrl };
