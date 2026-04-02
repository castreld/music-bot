'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { truncate } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || !player.isPlaying) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
    }

    const skipped = player.getCurrentTrack();
    player.skip();

    await interaction.reply({
      embeds: [successEmbed(`Skipped **${truncate(skipped?.title || 'Unknown', 100)}**.`)],
    });
  },
};
