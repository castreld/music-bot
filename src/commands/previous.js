'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('previous')
    .setDescription('Play the previous song in the queue.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || player.queue.length === 0) {
      return interaction.reply({ embeds: [errorEmbed('The queue is empty.')], ephemeral: true });
    }

    if (player.currentIndex <= 0) {
      return interaction.reply({ embeds: [errorEmbed('There is no previous song.')], ephemeral: true });
    }

    await interaction.deferReply();
    await player.previous();

    const track = player.getCurrentTrack();
    await interaction.editReply({ embeds: [nowPlayingEmbed(track, 0)] });
  },
};
