'use strict';

/**
 * Convert seconds to MM:SS or HH:MM:SS string.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Build a Unicode progress bar.
 * @param {number} elapsed  seconds elapsed
 * @param {number} total    total seconds
 * @param {number} length   bar character width
 * @returns {string}
 */
function buildProgressBar(elapsed, total, length = 20) {
  if (!total || total <= 0) return '▬'.repeat(length);
  const progress = Math.min(elapsed / total, 1);
  const filled = Math.round(progress * length);
  const bar = '▬'.repeat(Math.max(0, filled - 1)) + '🔘' + '▬'.repeat(length - filled);
  return bar;
}

/**
 * Truncate a string to maxLen characters, appending '…' if cut.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/**
 * Split an array into chunks of `size`.
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { formatDuration, buildProgressBar, truncate, chunkArray };
