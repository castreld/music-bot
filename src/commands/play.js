'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const YtDlp         = require('../core/YoutubeWrapper');
const { addedToQueueEmbed, nowPlayingEmbed, errorEmbed } = require('../utils/embeds');
const { getUserVoiceChannel, isUrl } = require('../utils/validators');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube.')
    .addStringOption(o =>
      o.setName('query')
        .setDescription('Song title or YouTube URL')
        .setRequired(true)),

  async execute(interaction) {
    console.log(`[play] received from ${interaction.user.tag}, guild=${interaction.guildId}`);

    await interaction.deferReply();

    const voiceChannel = getUserVoiceChannel(interaction);
    if (!voiceChannel) {
      return interaction.editReply({ content: '❌ You need to be in a voice channel first.' });
    }

    const query = interaction.options.getString('query', true);

    let track;
    try {
      if (isUrl(query)) {
        const info = await YtDlp.getVideoInfo(query);
        track = { ...info, requestedBy: interaction.user.tag };
      } else {
        const result = await YtDlp.findBestTrack(query);
        if (!result) return interaction.editReply({ embeds: [errorEmbed('No results found.')] });
        track = { ...result, requestedBy: interaction.user.tag };
      }
    } catch (err) {
      console.error('[play]', err);
      return interaction.editReply({ embeds: [errorEmbed('Could not fetch that track. Check the URL or try a different search.')] });
    }

    const player   = PlayerManager.get(interaction.guildId);
    player.setTextChannel(interaction.channel);

    const position = player.enqueue(track);
    const wasIdle  = !player.isPlaying;

    if (wasIdle) {
      player.connect(voiceChannel);
      player.currentIndex = player.queue.length - 1;
      await player.play();
      return interaction.editReply({ embeds: [nowPlayingEmbed(track, 0)] });
    }

    return interaction.editReply({ embeds: [addedToQueueEmbed(track, position)] });
  },
};
