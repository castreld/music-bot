'use strict';

/**
 * Ensure the interaction user is in a voice channel.
 * Replies with an error and returns false if not.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {import('discord.js').VoiceBasedChannel | null}
 */
function getUserVoiceChannel(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    interaction.reply({ content: '❌ You need to be in a voice channel first.', ephemeral: true });
    return null;
  }
  return channel;
}

/**
 * Ensure there is an active MusicPlayer with a queue.
 * @param {import('../core/MusicPlayer')} player
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
function assertQueueNotEmpty(player, interaction) {
  if (!player || player.queue.length === 0) {
    interaction.reply({ content: '❌ The queue is empty.', ephemeral: true });
    return false;
  }
  return true;
}

/**
 * Ensure a 1-based queue position is valid.
 * @param {number} position  1-based
 * @param {number} queueLength
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
function assertValidPosition(position, queueLength, interaction) {
  if (!Number.isInteger(position) || position < 1 || position > queueLength) {
    interaction.reply({
      content: `❌ Invalid position. Please enter a number between 1 and ${queueLength}.`,
      ephemeral: true,
    });
    return false;
  }
  return true;
}

/**
 * Detect whether a string is a URL.
 * @param {string} str
 * @returns {boolean}
 */
function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

module.exports = { getUserVoiceChannel, assertQueueNotEmpty, assertValidPosition, isUrl };
