'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing song.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);
    const track  = player?.getCurrentTrack();

    if (!track) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
    }

    const elapsed = player.getElapsed();
    await interaction.reply({ embeds: [nowPlayingEmbed(track, elapsed)] });
  },
};
