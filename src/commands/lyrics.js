'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const { lyricsEmbeds, errorEmbed } = require('../utils/embeds');

/**
 * Split a YouTube-style title into artist + song for lyrics.ovh.
 * Handles "Artist - Song Title (Official Video)" etc.
 */
function parseArtistTitle(rawTitle, uploader) {
  const clean = t => t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();

  const dash = rawTitle.indexOf(' - ');
  if (dash !== -1) {
    return { artist: rawTitle.slice(0, dash).trim(), title: clean(rawTitle.slice(dash + 3)) };
  }
  return { artist: uploader || '', title: clean(rawTitle) };
}

async function fetchLyrics(artist, title) {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.lyrics || null;
}

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

    const player   = PlayerManager.get(interaction.guildId);
    const override = interaction.options.getString('title');
    const track    = player?.getCurrentTrack();

    const rawTitle = override || track?.title;
    if (!rawTitle) {
      return interaction.editReply({ embeds: [errorEmbed('Nothing is playing and no title was provided.')] });
    }

    const { artist, title } = parseArtistTitle(rawTitle, track?.uploader);

    let lyrics = null;
    try {
      lyrics = await fetchLyrics(artist, title);
      // If the split gave us an artist but returned nothing, retry with full title and no artist
      if (!lyrics && artist) {
        lyrics = await fetchLyrics('', rawTitle);
      }
    } catch (err) {
      console.error('[lyrics]', err.message);
      return interaction.editReply({ embeds: [errorEmbed('Could not fetch lyrics. Try again later.')] });
    }

    if (!lyrics || lyrics.trim().length === 0) {
      return interaction.editReply({ embeds: [errorEmbed(`Lyrics not available for **${rawTitle}**.`)] });
    }

    const displayTrack = track || { title: rawTitle, url: null };
    const embeds = lyricsEmbeds(displayTrack, lyrics);

    await interaction.editReply({ embeds: [embeds[0]] });
    for (let i = 1; i < embeds.length; i++) {
      await interaction.followUp({ embeds: [embeds[i]] });
    }
  },
};
