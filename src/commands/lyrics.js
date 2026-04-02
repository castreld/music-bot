'use strict';

const { SlashCommandBuilder } = require('discord.js');
const Genius        = require('genius-lyrics');
const PlayerManager = require('../core/PlayerManager');
const { lyricsEmbeds, errorEmbed } = require('../utils/embeds');

// Client is created once and reused. Works without a key but is less reliable.
const geniusClient = new Genius.Client(process.env.GENIUS_API_KEY || '');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Show the lyrics of the currently playing song.')
    .addStringOption(o =>
      o.setName('title')
        .setDescription('Override: search for a specific song instead of the current one')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const player = PlayerManager.get(interaction.guildId);
    const override = interaction.options.getString('title');
    const track    = player?.getCurrentTrack();

    const searchTitle = override || track?.title;

    if (!searchTitle) {
      return interaction.editReply({ embeds: [errorEmbed('Nothing is playing and no title was provided.')] });
    }

    let lyrics;
    try {
      const results = await geniusClient.songs.search(searchTitle);
      if (!results || results.length === 0) {
        return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${searchTitle}**.`)] });
      }
      lyrics = await results[0].lyrics();
    } catch (err) {
      console.error('[lyrics]', err);
      return interaction.editReply({ embeds: [errorEmbed('Could not fetch lyrics. Try again later.')] });
    }

    if (!lyrics || lyrics.trim().length === 0) {
      return interaction.editReply({ embeds: [errorEmbed(`Lyrics not available for **${searchTitle}**.`)] });
    }

    const displayTrack = track || { title: searchTitle, url: null };
    const embeds = lyricsEmbeds(displayTrack, lyrics);

    // Discord allows max 10 embeds per message; send first one as reply, rest as follow-ups
    await interaction.editReply({ embeds: [embeds[0]] });
    for (let i = 1; i < embeds.length; i++) {
      await interaction.followUp({ embeds: [embeds[i]] });
    }
  },
};
