'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const MODEL        = 'gemini-2.5-flash';
const TIMEOUT_MS   = 8_000;

/** @type {import('@google/generative-ai').GenerativeModel | null} */
let model = null;

const SYSTEM_PROMPT = `\
You are an API endpoint, not a conversational assistant.
You MUST reply with a raw JSON array and absolutely nothing else.
Do NOT include markdown formatting such as \`\`\`json or \`\`\`.
Do NOT include any explanation, greeting, or text before or after the JSON.
Your entire response must be parseable by JSON.parse() with no pre-processing.

You are a mainstream radio DJ. Recommend highly popular, top-charting, widely recognized hit songs that match the vibe of the current song.
DO NOT recommend obscure, unpopular, or B-side tracks.
Analyze the genre, mood, tempo, and language of the current song.
Never recommend alternate versions (live, cover, remix, sped up, slowed, acoustic, karaoke).
If the current song is in Indonesian, prioritize popular Indonesian songs.
Each recommendation must be a completely different song from the others and from the history.

Required output — a JSON array of exactly 3 objects, nothing else:
[{"title": "song title", "artist": "artist name"}, ...]`;

/**
 * Call once at startup. No-ops silently if GEMINI_API_KEY is not set.
 */
function init() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('[Gemini] No GEMINI_API_KEY set — autoplay will use fallback.');
    return;
  }
  const genAI = new GoogleGenerativeAI(key);
  model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            title:  { type: SchemaType.STRING },
            artist: { type: SchemaType.STRING },
          },
          required: ['title', 'artist'],
        },
      },
      temperature:     1.0,
      maxOutputTokens: 256,
    },
  });
  console.log('[Gemini] Ready.');
}

/**
 * Strip YouTube upload noise from a title so Gemini sees clean song names.
 * e.g. "Bohemian Rhapsody (Official Music Video) [Lyrics] | HD Audio" → "Bohemian Rhapsody"
 * @param {string} title
 * @returns {string}
 */
function cleanTitle(title) {
  return title
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')   // remove (anything) and [anything]
    .replace(/\b(lyrics?|official\s+(music\s+)?video|official\s+audio|music\s+video|audio|mv|hd|4k|visualizer|lyric\s+video|lirik(\s+lagu)?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Ask Gemini for a batch of song recommendations.
 *
 * @param {{ title: string, uploader: string }} currentTrack
 * @param {{ title: string, uploader: string }[]} history
 * @param {number} count  how many songs to request (default 3)
 * @returns {Promise<{ title: string, artist: string }[]>}  empty array on failure
 */
async function recommendBatch(currentTrack, history = [], count = 3) {
  if (!model) return [];

  const cleanCurrent = cleanTitle(currentTrack.title);
  const seedArtist   = currentTrack.uploader.replace(/\s*-\s*Topic$/i, '').trim();

  const cleanHistory = history.map(t => {
    const artist = t.uploader.replace(/\s*-\s*Topic$/i, '').trim();
    return `${artist} - ${cleanTitle(t.title)}`;
  });

  const historyBlock = cleanHistory.length
    ? cleanHistory.map(s => `  - "${s}"`).join('\n')
    : '  (none)';

  const prompt =
    `Current song: "${cleanCurrent}" by "${seedArtist}"\n\n` +
    `CRITICAL: You MUST NOT recommend any song in this history. If you do, the system will crash:\n${historyBlock}\n\n` +
    `CRITICAL: You MUST NOT recommend the current song "${cleanCurrent}".\n\n` +
    `Return exactly ${count} different song recommendations as a JSON array:`;

  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout')), TIMEOUT_MS)
      ),
    ]);

    const recs = JSON.parse(result.response.text());
    if (!Array.isArray(recs)) throw new Error('Response is not an array');

    // Validate shape and run amnesia check
    const recentNorm = [currentTrack, ...history.slice(-3)]
      .map(t => cleanTitle(t.title).toLowerCase().trim());

    const valid = recs.filter(r => {
      if (typeof r.title !== 'string' || typeof r.artist !== 'string') return false;
      const norm = r.title.toLowerCase().trim();
      if (recentNorm.some(t => t.includes(norm) || norm.includes(t))) {
        console.warn(`[Gemini] Amnesia — skipping recent song: "${r.title}"`);
        return false;
      }
      return true;
    });

    console.log(`[Gemini] Batch: ${valid.map(r => `"${r.artist} - ${r.title}"`).join(', ')}`);
    return valid;
  } catch (err) {
    console.error('[Gemini] Batch recommendation failed:', err.message);
    return [];
  }
}

/**
 * Fetch lyrics for a song using Gemini as a fallback when lyrics.ovh fails.
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<string | null>}
 */
async function getLyrics(artist, title) {
  if (!model) return null;

  const prompt =
    `Provide the full lyrics for "${title}" by "${artist}".\n` +
    `Return ONLY the lyrics text with no intro, no explanation, no markdown formatting. ` +
    `If you do not know the lyrics, respond with exactly: NOT_FOUND`;

  try {
    // Use a plain text response for lyrics — no JSON schema needed
    const genAI      = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const lyricsModel = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    });

    const result = await Promise.race([
      lyricsModel.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini lyrics timeout')), TIMEOUT_MS)
      ),
    ]);

    const text = result.response.text().trim();
    if (!text || text === 'NOT_FOUND') return null;
    return text;
  } catch (err) {
    console.error('[Gemini] Lyrics fetch failed:', err.message);
    return null;
  }
}

module.exports = { init, recommendBatch, getLyrics };
