'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');
const { assertQueueNotEmpty, assertValidPosition } = require('../utils/validators');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Jump to a specific position in the queue.')
    .addIntegerOption(o =>
      o.setName('position')
        .setDescription('Queue position to jump to (1 = first)')
        .setRequired(true)
        .setMinValue(1)),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!assertQueueNotEmpty(player, interaction)) return;

    const position = interaction.options.getInteger('position', true);
    if (!assertValidPosition(position, player.queue.length, interaction)) return;

    await interaction.deferReply();
    await player.jump(position);

    const track = player.getCurrentTrack();
    await interaction.editReply({ embeds: [nowPlayingEmbed(track, 0)] });
  },
};
