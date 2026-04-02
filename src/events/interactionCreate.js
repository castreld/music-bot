'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const YtDlp        = require('../core/YtDlpWrapper');
const { errorEmbed, addedToQueueEmbed, queueEmbed } = require('../utils/embeds');
const { getUserVoiceChannel } = require('../utils/validators');

const PAGE_SIZE = 10;

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {

    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(`[Command:${interaction.commandName}]`, err);
        const msg = { embeds: [errorEmbed('Something went wrong running that command.')], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
      return;
    }

    // ── Search select menu ────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('search_select:')) {
      const [, userId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
      }

      const voiceChannel = getUserVoiceChannel(interaction);
      if (!voiceChannel) return;

      await interaction.deferUpdate();

      const selectedUrl = interaction.values[0];
      let track;
      try {
        const info = await YtDlp.getVideoInfo(selectedUrl);
        track = { ...info, requestedBy: interaction.user.tag };
      } catch (err) {
        return interaction.followUp({ embeds: [errorEmbed('Could not fetch that video.')], ephemeral: true });
      }

      const player = PlayerManager.get(interaction.guildId);
      player.setTextChannel(interaction.channel);

      const position = player.enqueue(track);
      const wasIdle  = !player.isPlaying;

      if (wasIdle) {
        player.connect(voiceChannel);
        player.currentIndex = player.queue.length - 1;
        await player.play();
      }

      await interaction.editReply({
        embeds: [addedToQueueEmbed(track, wasIdle ? 1 : position)],
        components: [],
      });
      return;
    }

    // ── Queue pagination buttons ──────────────────────────────────────────────
    if (interaction.isButton()) {
      const [action, pageStr, userId] = interaction.customId.split(':');

      if (action !== 'queue_prev' && action !== 'queue_next') return;

      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ These buttons are not for you.', ephemeral: true });
      }

      const player = PlayerManager.get(interaction.guildId);
      if (!player || player.queue.length === 0) {
        return interaction.update({ content: '❌ The queue is now empty.', embeds: [], components: [] });
      }

      const currentPage = parseInt(pageStr, 10);
      const newPage = action === 'queue_next' ? currentPage + 1 : currentPage - 1;
      const totalPages = Math.ceil(player.queue.length / PAGE_SIZE);

      const embed = queueEmbed(player.queue, player.currentIndex, newPage, PAGE_SIZE);
      const row   = buildPaginationRow(newPage, totalPages, interaction.user.id);

      await interaction.update({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
    }
  },
};

function buildPaginationRow(page, totalPages, userId) {
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
