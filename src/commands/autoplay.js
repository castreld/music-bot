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

    const state = player.autoplay ? 'enabled' : 'disabled';
    const hint  = player.autoplay
      ? 'Related songs will play automatically when the queue ends.'
      : 'The bot will stop when the queue ends.';

    await interaction.reply({
      embeds: [successEmbed(`Autoplay **${state}**. ${hint}`)],
    });
  },
};
