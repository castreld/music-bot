'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('video')
    .setDescription('Post the YouTube video of the currently playing song.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);
    const track  = player?.getCurrentTrack();

    if (!track) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
    }

    await interaction.reply(`**${track.title}**\n${track.url}`);
  },
};
