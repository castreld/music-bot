'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const COMMANDS = [
  { name: '/play <query>',         desc: 'Play a song by title or YouTube URL' },
  { name: '/search <query>',       desc: 'Search YouTube and pick from a list' },
  { name: '/queue',                desc: 'Show the current song queue' },
  { name: '/nowplaying',           desc: 'Show the currently playing song with progress' },
  { name: '/skip',                 desc: 'Skip the current song' },
  { name: '/previous',             desc: 'Go back to the previous song' },
  { name: '/pause',                desc: 'Pause or resume playback' },
  { name: '/jump <position>',      desc: 'Jump to a specific position in the queue' },
  { name: '/remove <position>',    desc: 'Remove a song from the queue' },
  { name: '/lyrics [title]',       desc: 'Show lyrics for the current (or a given) song' },
  { name: '/autoplay',             desc: 'Toggle autoplay — plays related songs when queue ends' },
  { name: '/leave',                desc: 'Disconnect the bot and clear the queue' },
  { name: '/help',                 desc: 'Show this help message' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands.'),

  async execute(interaction) {
    const fields = COMMANDS.map(c => ({
      name:   c.name,
      value:  c.desc,
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Music Bot — Commands')
      .addFields(fields)
      .setFooter({ text: 'Music powered by YouTube via play-dl' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
