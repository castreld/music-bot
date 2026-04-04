'use strict';

const textToSpeech           = require('@google-cloud/text-to-speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq                   = require('groq-sdk');

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GROQ_MODEL     = 'llama3-8b-8192';
const GEMINI_TIMEOUT = 4_000;
const GROQ_TIMEOUT   = 5_000;
const TTS_TIMEOUT    = 8_000;

// Voice configs per language — Neural2 female voices
const VOICES = {
  indonesian: { languageCode: 'id-ID', name: 'id-ID-Neural2-A', ssmlGender: 'FEMALE' },
  english:    { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
};

// Tier 3: static template fallbacks
const TEMPLATES = {
  english: [
    "Up next, {title} by {artist}!",
    "Here it comes — {title} from {artist}!",
    "Get ready for {title} by {artist}!",
    "Next up on the playlist, {title} by {artist}!",
    "You're listening to {title} by {artist}!",
  ],
  indonesian: [
    "Dan sekarang, mari kita dengarkan {title} dari {artist}!",
    "Tetap di sini, lagu selanjutnya ada {title} dari {artist}!",
    "Lanjut terus! Ini dia {title} dari {artist}.",
    "Siap-siap, sekarang giliran {title} dari {artist}!",
    "Nikmati {title} dari {artist} berikut ini!",
  ],
};

/** @type {import('@google-cloud/text-to-speech').TextToSpeechClient | null} */
let ttsClient   = null;
/** @type {import('@google/generative-ai').GenerativeModel | null} */
let scriptModel = null;
/** @type {import('groq-sdk') | null} */
let groqClient  = null;

/**
 * Call once at startup. Silently disables TTS if credentials are missing.
 * Groq is optional — missing key just skips Tier 2.
 */
function init() {
  const ttsKey    = process.env.GOOGLE_CLOUD_TTS_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey   = process.env.GROQ_API_KEY;

  if (!ttsKey || !geminiKey) {
    console.log('[DJAnnounce] Disabled — set GOOGLE_CLOUD_TTS_KEY and GEMINI_API_KEY to enable.');
    return;
  }

  try {
    ttsClient = new textToSpeech.TextToSpeechClient({
      credentials: JSON.parse(ttsKey),
    });

    const genAI = new GoogleGenerativeAI(geminiKey);
    scriptModel = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature:     1.2,
        maxOutputTokens: 60,
      },
    });

    if (groqKey) {
      groqClient = new Groq({ apiKey: groqKey });
      console.log('[DJAnnounce] Ready (Gemini + Groq fallback).');
    } else {
      console.log('[DJAnnounce] Ready (Gemini only — set GROQ_API_KEY to enable Groq fallback).');
    }
  } catch (err) {
    console.error('[DJAnnounce] Init failed:', err.message);
  }
}

/**
 * Build the DJ script prompt shared across AI tiers.
 */
function buildPrompt(track, language) {
  const lang   = language === 'indonesian' ? 'Indonesian' : 'English';
  const artist = track.uploader.replace(/\s*-\s*Topic$/i, '').trim();
  const title  = track.title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim();
  return {
    prompt:
      `Write a cool, energetic, and short radio DJ intro for the next song. ` +
      `Use the ${lang} language. Make it sound like a professional female radio announcer. ` +
      `Only return the spoken text — no quotes, no labels, no extra punctuation. Max 15 words. ` +
      `Song: "${title}" by "${artist}".`,
    artist,
    title,
  };
}

/** Strip surrounding quotes the model sometimes adds. */
function stripQuotes(text) {
  return text.trim().replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '').trim();
}

/**
 * Tier 3: pick a random static template and fill in track metadata.
 */
function staticFallback(track, language) {
  const lang      = language === 'indonesian' ? 'indonesian' : 'english';
  const templates = TEMPLATES[lang];
  const template  = templates[Math.floor(Math.random() * templates.length)];
  const artist    = track.uploader.replace(/\s*-\s*Topic$/i, '').trim();
  const title     = track.title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim();
  return template.replace('{title}', title).replace('{artist}', artist);
}

/**
 * Generate a DJ script via a 3-tier fallback pipeline:
 *   Tier 1 — Gemini 2.5 Flash   (4 s timeout)
 *   Tier 2 — Groq / Llama 3     (5 s timeout, requires GROQ_API_KEY)
 *   Tier 3 — Static templates   (always succeeds)
 *
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<string>}
 */
async function generateScript(track, language) {
  const { prompt } = buildPrompt(track, language);

  // ── Tier 1: Gemini ────────────────────────────────────────────────────────
  if (scriptModel) {
    try {
      const result = await Promise.race([
        scriptModel.generateContent(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), GEMINI_TIMEOUT)),
      ]);
      const text = stripQuotes(result.response.text());
      if (text) {
        console.log(`[DJAnnounce] Tier1 (Gemini): "${text}"`);
        return text;
      }
    } catch (err) {
      const reason = err.message?.includes('429') ? 'rate limited' : err.message;
      console.warn(`[DJAnnounce] Tier1 failed (${reason}) — trying Groq`);
    }
  }

  // ── Tier 2: Groq / Llama 3 ───────────────────────────────────────────────
  if (groqClient) {
    try {
      const completion = await Promise.race([
        groqClient.chat.completions.create({
          model:      GROQ_MODEL,
          max_tokens: 60,
          temperature: 1.2,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), GROQ_TIMEOUT)),
      ]);
      const text = stripQuotes(completion.choices[0]?.message?.content ?? '');
      if (text) {
        console.log(`[DJAnnounce] Tier2 (Groq): "${text}"`);
        return text;
      }
    } catch (err) {
      console.warn(`[DJAnnounce] Tier2 failed (${err.message}) — using static template`);
    }
  }

  // ── Tier 3: Static template ───────────────────────────────────────────────
  const text = staticFallback(track, language);
  console.log(`[DJAnnounce] Tier3 (static): "${text}"`);
  return text;
}

/**
 * Convert a DJ script to OGG Opus audio via Google Cloud TTS.
 * @param {string} text
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<Buffer>}
 */
async function generateTTS(text, language) {
  const voice = VOICES[language] ?? VOICES.english;

  const [response] = await Promise.race([
    ttsClient.synthesizeSpeech({
      input:       { text },
      voice,
      audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: 1.1 },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), TTS_TIMEOUT)),
  ]);

  return Buffer.from(response.audioContent);
}

/**
 * Full pipeline: generate script → synthesise TTS → return audio Buffer.
 * Returns null only if TTS itself fails (script generation always succeeds via Tier 3).
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<Buffer | null>}
 */
async function announce(track, language) {
  if (!ttsClient || !scriptModel) return null;

  try {
    const script = await generateScript(track, language);
    return await generateTTS(script, language);
  } catch (err) {
    console.error('[DJAnnounce] Pipeline error:', err.message);
    return null;
  }
}

/** @returns {boolean} */
function isReady() { return ttsClient !== null && scriptModel !== null; }

module.exports = { init, announce, isReady };
