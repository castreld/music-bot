'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay — plays related songs when the queue ends.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || !player.isPlaying) {
      return interaction.reply({
        embeds: [errorEmbed('Nothing is playing. Start a song first.')],
        ephemeral: true,
      });
    }

    player.autoplay = !player.autoplay;

    const state = player.autoplay ? 'enabled' : 'disabled';
    const icon  = player.autoplay ? '🔀' : '⏹️';
    await interaction.reply({
      embeds: [successEmbed(`${icon} Autoplay **${state}**.`)],
    });
  },
};
