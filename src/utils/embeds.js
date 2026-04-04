'use strict';

const { EmbedBuilder } = require('discord.js');
const { formatDuration, buildProgressBar, truncate } = require('./formatters');

const COLOR_PRIMARY  = 0x5865F2; // Discord blurple
const COLOR_SUCCESS  = 0x57F287;
const COLOR_ERROR    = 0xED4245;
const COLOR_WARNING  = 0xFEE75C;

function errorEmbed(message) {
  return new EmbedBuilder().setColor(COLOR_ERROR).setDescription(`❌ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor(COLOR_SUCCESS).setDescription(`✅ ${message}`);
}

/**
 * "Added to queue" embed.
 * @param {object} track
 * @param {number} position  1-based queue position
 */
function addedToQueueEmbed(track, position) {
  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle('Added to Queue')
    .setDescription(`**[${truncate(track.title, 100)}](${track.url})**`)
    .setThumbnail(track.thumbnail)
    .addFields(
      { name: 'Duration',   value: formatDuration(track.duration), inline: true },
      { name: 'Uploader',   value: truncate(track.uploader, 50),   inline: true },
      { name: 'Position',   value: `#${position}`,                 inline: true },
    )
    .setFooter({ text: `Requested by ${track.requestedBy}` });
}

/**
 * "Now Playing" embed with progress bar.
 * @param {object} track
 * @param {number} elapsed  seconds elapsed
 */
function nowPlayingEmbed(track, elapsed) {
  const total = track.duration || 0;
  const bar   = buildProgressBar(elapsed, total);
  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setAuthor({ name: 'Now Playing' })
    .setTitle(truncate(track.title, 250))
    .setURL(track.url)
    .setThumbnail(track.thumbnail)
    .addFields(
      { name: 'Duration', value: `\`${formatDuration(elapsed)} / ${formatDuration(total)}\``, inline: true },
      { name: 'Uploader', value: truncate(track.uploader, 50), inline: true },
      { name: 'Requested by', value: track.requestedBy, inline: true },
      { name: '\u200B', value: bar },
    );
}

/**
 * Queue page embed.
 * @param {object[]} queue       full queue
 * @param {number}   currentIndex 0-based
 * @param {number}   page        0-based page number
 * @param {number}   pageSize
 */
function queueEmbed(queue, currentIndex, page, pageSize = 10) {
  const totalPages = Math.ceil(queue.length / pageSize);
  const start      = page * pageSize;
  const slice      = queue.slice(start, start + pageSize);

  const lines = slice.map((track, i) => {
    const pos    = start + i;
    const icon   = pos === currentIndex ? '▶' : `${pos + 1}.`;
    const dur    = formatDuration(track.duration);
    const tag    = track.isAutoplay ? ' `🔀 Autoplay`' : '';
    return `${icon} **${truncate(track.title, 60)}** \`[${dur}]\`${tag}`;
  });

  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle('Queue')
    .setDescription(lines.join('\n') || 'Empty')
    .setFooter({ text: `Page ${page + 1} / ${totalPages} · ${queue.length} track${queue.length !== 1 ? 's' : ''}` });
}

/**
 * Search results embed (shown above the select menu).
 * @param {object[]} results
 */
function searchResultsEmbed(results) {
  const lines = results.map((r, i) =>
    `**${i + 1}.** ${truncate(r.title, 80)} \`[${formatDuration(r.duration)}]\` — ${truncate(r.uploader, 40)}`
  );
  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle('Search Results')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Select a song from the dropdown below.' });
}

/**
 * Lyrics embed — handles Discord 4096-char description limit.
 * Returns one or more embeds (split if lyrics are long).
 * @param {object} track
 * @param {string} lyrics
 * @returns {EmbedBuilder[]}
 */
function lyricsEmbeds(track, lyrics) {
  const MAX = 4000;
  const chunks = [];
  let remaining = lyrics;
  while (remaining.length > 0) {
    // Try to split on a newline boundary
    let end = MAX;
    if (remaining.length > MAX) {
      const nl = remaining.lastIndexOf('\n', MAX);
      end = nl > 0 ? nl : MAX;
    }
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  return chunks.map((chunk, i) =>
    new EmbedBuilder()
      .setColor(COLOR_PRIMARY)
      .setTitle(i === 0 ? `Lyrics — ${truncate(track.title, 200)}` : '\u200B')
      .setDescription(chunk)
      .setFooter({ text: i === chunks.length - 1 ? 'Powered by Genius' : '\u200B' })
  );
}

module.exports = {
  errorEmbed,
  successEmbed,
  addedToQueueEmbed,
  nowPlayingEmbed,
  queueEmbed,
  searchResultsEmbed,
  lyricsEmbeds,
};
