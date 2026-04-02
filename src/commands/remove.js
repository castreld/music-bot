'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { assertQueueNotEmpty, assertValidPosition } = require('../utils/validators');
const { truncate } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue.')
    .addIntegerOption(o =>
      o.setName('position')
        .setDescription('Queue position to remove (1 = first)')
        .setRequired(true)
        .setMinValue(1)),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!assertQueueNotEmpty(player, interaction)) return;

    const position = interaction.options.getInteger('position', true);
    if (!assertValidPosition(position, player.queue.length, interaction)) return;

    const removed = player.remove(position);
    if (!removed) {
      return interaction.reply({ embeds: [errorEmbed('Could not remove that track.')], ephemeral: true });
    }

    await interaction.reply({
      embeds: [successEmbed(`Removed **${truncate(removed.title, 100)}** from the queue.`)],
    });
  },
};
