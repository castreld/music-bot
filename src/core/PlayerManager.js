'use strict';

const MusicPlayer = require('./MusicPlayer');

/** @type {Map<string, MusicPlayer>} */
const players = new Map();

/**
 * Get or create a MusicPlayer for the given guild.
 * @param {string} guildId
 * @returns {MusicPlayer}
 */
function get(guildId) {
  if (!players.has(guildId)) {
    players.set(guildId, new MusicPlayer(guildId));
  }
  return players.get(guildId);
}

/**
 * Destroy and remove the player for a guild.
 * @param {string} guildId
 */
function remove(guildId) {
  const player = players.get(guildId);
  if (player) {
    player.destroy();
    players.delete(guildId);
  }
}

/**
 * Check if a guild has an active player.
 * @param {string} guildId
 * @returns {boolean}
 */
function has(guildId) {
  return players.has(guildId);
}

module.exports = { get, remove, has };
