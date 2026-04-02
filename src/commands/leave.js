'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect the bot from the voice channel and clear the queue.'),

  async execute(interaction) {
    if (!PlayerManager.has(interaction.guildId)) {
      return interaction.reply({ embeds: [errorEmbed('I am not in a voice channel.')], ephemeral: true });
    }

    PlayerManager.remove(interaction.guildId);
    await interaction.reply({ embeds: [successEmbed('Disconnected and cleared the queue.')] });
  },
};
