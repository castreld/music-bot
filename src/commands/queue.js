'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { queueEmbed, errorEmbed } = require('../utils/embeds');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current song queue.'),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || player.queue.length === 0) {
      return interaction.reply({ embeds: [errorEmbed('The queue is empty.')], ephemeral: true });
    }

    const page       = 0;
    const totalPages = Math.ceil(player.queue.length / PAGE_SIZE);
    const embed      = queueEmbed(player.queue, player.currentIndex, page, PAGE_SIZE);

    const components = [];
    if (totalPages > 1) {
      components.push(buildRow(page, totalPages, interaction.user.id));
    }

    await interaction.reply({ embeds: [embed], components });
  },
};

function buildRow(page, totalPages, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_prev:${page}:${userId}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`queue_next:${page}:${userId}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}
