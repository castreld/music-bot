'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL        = 'gemini-2.5-flash';
const TIMEOUT_MS   = 8_000;

/** @type {import('@google/generative-ai').GenerativeModel | null} */
let model = null;

const SYSTEM_PROMPT = `\
You are a music DJ for a Discord bot. Your only job is to recommend the next song to queue.

Rules:
- Analyze the genre, mood, tempo, and language of the current song
- Recommend exactly ONE song that fits the same vibe
- Prefer popular, well-known tracks with official releases
- Never recommend a song already in the play history
- Never recommend alternate versions (live, cover, remix, sped up, slowed, acoustic, karaoke)
- If the current song is in Indonesian, prioritize Indonesian songs in return
- Respond ONLY with a JSON object — no markdown, no explanation outside the JSON

Required JSON schema:
{"title": "song title", "artist": "artist name", "reason": "one sentence vibe match"}`;

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
      temperature:      1.0,   // creative but not chaotic
      maxOutputTokens:  256,
    },
  });
  console.log('[Gemini] Ready.');
}

/**
 * Ask Gemini to recommend the next track.
 *
 * @param {{ title: string, uploader: string }} currentTrack
 * @param {{ title: string, uploader: string }[]} history  – last N played tracks
 * @returns {Promise<{ title: string, artist: string, reason: string } | null>}
 */
async function recommend(currentTrack, history = []) {
  if (!model) return null;

  const historyLines = history.length
    ? history.map(t => `  - "${t.title}" by "${t.uploader}"`).join('\n')
    : '  (none)';

  const prompt =
    `Current song: "${currentTrack.title}" by "${currentTrack.uploader}"\n` +
    `Play history (do NOT repeat these):\n${historyLines}\n\n` +
    `Recommend the next song:`;

  try {
    const race = Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout')), TIMEOUT_MS)
      ),
    ]);

    const result = await race;
    const text   = result.response.text().trim();
    const rec    = JSON.parse(text);

    if (typeof rec.title !== 'string' || typeof rec.artist !== 'string') {
      throw new Error('Invalid response schema');
    }

    console.log(`[Gemini] Recommends: "${rec.artist} - ${rec.title}" — ${rec.reason}`);
    return rec;
  } catch (err) {
    console.error('[Gemini] Recommendation failed:', err.message);
    return null;
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

module.exports = { init, recommend, getLyrics };
