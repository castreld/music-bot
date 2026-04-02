'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause or resume the current song.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || !player.isPlaying) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
    }

    if (player.isPaused) {
      player.resume();
      return interaction.reply({ embeds: [successEmbed('Resumed playback.')] });
    } else {
      player.pause();
      return interaction.reply({ embeds: [successEmbed('Paused playback.')] });
    }
  },
};
