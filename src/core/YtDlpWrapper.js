const { spawn } = require('child_process');

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

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
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-g',
    url,
  ]);
  return raw.trim().split('\n')[0];
}

module.exports = { search, getVideoInfo, getStreamUrl };
