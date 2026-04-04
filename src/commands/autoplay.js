'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay — the bot will queue related songs when the queue ends.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || !player.isPlaying) {
      return interaction.reply({
        embeds: [errorEmbed('Nothing is playing right now.')],
        ephemeral: true,
      });
    }

    player.autoplay = !player.autoplay;

    if (player.autoplay) {
      // Eagerly pre-fetch 3 songs so users see the queue fill up immediately
      player._prefetchAutoplay(3).catch(() => {});
    } else {
      // Remove queued autoplay tracks so manual queue is clean
      const firstAutoplay = player.queue.findIndex(
        (t, i) => i > player.currentIndex && t.isAutoplay
      );
      if (firstAutoplay !== -1) player.queue.splice(firstAutoplay);
    }

    const state = player.autoplay ? 'enabled' : 'disabled';
    const hint  = player.autoplay
      ? 'Fetching upcoming songs — check **/queue** in a moment.'
      : 'Autoplay songs removed from the queue.';

    await interaction.reply({
      embeds: [successEmbed(`Autoplay **${state}**. ${hint}`)],
    });
  },
};
