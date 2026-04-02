'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const YtDlp  = require('../core/YtDlpWrapper');
const { searchResultsEmbed, errorEmbed } = require('../utils/embeds');
const { getUserVoiceChannel } = require('../utils/validators');
const { truncate, formatDuration } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and pick a song from a list.')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('Song title to search for')
        .setRequired(true)),

  async execute(interaction) {
    const voiceChannel = getUserVoiceChannel(interaction);
    if (!voiceChannel) return;

    const query = interaction.options.getString('query', true);
    await interaction.deferReply({ ephemeral: true });

    let results;
    try {
      results = await YtDlp.search(query, 5);
    } catch (err) {
      console.error('[search]', err);
      return interaction.editReply({ embeds: [errorEmbed('Search failed. Please try again.')] });
    }

    if (!results.length) {
      return interaction.editReply({ embeds: [errorEmbed('No results found.')] });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`search_select:${interaction.user.id}`)
      .setPlaceholder('Choose a song…')
      .addOptions(
        results.map(r => ({
          label:       truncate(r.title, 100),
          description: `${truncate(r.uploader, 50)} · ${formatDuration(r.duration)}`,
          value:       r.url,
        }))
      );

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.editReply({
      embeds:     [searchResultsEmbed(results)],
      components: [row],
    });
  },
};
