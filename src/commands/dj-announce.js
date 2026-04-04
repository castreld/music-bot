'use strict';

const { SlashCommandBuilder } = require('discord.js');
const PlayerManager = require('../core/PlayerManager');
const DJAnnouncer   = require('../core/DJAnnouncer');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dj-announce')
    .setDescription('Toggle AI radio DJ announcements before each song.')
    .addStringOption(o =>
      o.setName('language')
        .setDescription('Language for the DJ announcements')
        .setRequired(false)
        .addChoices(
          { name: 'Indonesian', value: 'indonesian' },
          { name: 'English',    value: 'english' },
        )),

  async execute(interaction) {
    const player = PlayerManager.get(interaction.guildId);

    if (!player || !player.isPlaying) {
      return interaction.reply({
        embeds:    [errorEmbed('Nothing is playing right now.')],
        ephemeral: true,
      });
    }

    if (!DJAnnouncer.isReady()) {
      return interaction.reply({
        embeds:    [errorEmbed('DJ Announce is not configured. Set `GOOGLE_CLOUD_TTS_KEY` in your environment.')],
        ephemeral: true,
      });
    }

    const language = interaction.options.getString('language');

    // Toggle: if currently enabled with same language (or no language given), turn off.
    // Otherwise turn on (with the new language, or keep existing language).
    if (player.djAnnounce?.enabled && (!language || player.djAnnounce.language === language)) {
      player.djAnnounce = null;
      return interaction.reply({
        embeds: [successEmbed('DJ Announce **disabled**.')],
      });
    }

    player.djAnnounce = {
      enabled:  true,
      language: language ?? player.djAnnounce?.language ?? 'english',
    };

    const lang = player.djAnnounce.language === 'indonesian' ? 'Indonesian' : 'English';
    await interaction.reply({
      embeds: [successEmbed(`DJ Announce **enabled** in **${lang}**. The bot will introduce each song before it plays.`)],
    });
  },
};
