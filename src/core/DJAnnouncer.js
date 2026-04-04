'use strict';

const textToSpeech        = require('@google-cloud/text-to-speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL  = 'gemini-2.5-flash';
const SCRIPT_TIMEOUT = 5_000;
const TTS_TIMEOUT    = 8_000;

// Voice configs per language — Neural2 female voices
const VOICES = {
  indonesian: { languageCode: 'id-ID', name: 'id-ID-Neural2-A', ssmlGender: 'FEMALE' },
  english:    { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
};

/** @type {import('@google-cloud/text-to-speech').TextToSpeechClient | null} */
let ttsClient   = null;
/** @type {import('@google/generative-ai').GenerativeModel | null} */
let scriptModel = null;

/**
 * Call once at startup. Silently disables if credentials are missing.
 */
function init() {
  const ttsKey   = process.env.GOOGLE_CLOUD_TTS_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

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
        temperature:    1.2,   // creative, energetic
        maxOutputTokens: 60,   // strictly short
      },
    });

    console.log('[DJAnnounce] Ready.');
  } catch (err) {
    console.error('[DJAnnounce] Init failed:', err.message);
  }
}

/**
 * Ask Gemini to write a short DJ intro script for the next track.
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<string>}
 */
async function generateScript(track, language) {
  const lang   = language === 'indonesian' ? 'Indonesian' : 'English';
  const artist = track.uploader.replace(/\s*-\s*Topic$/i, '').trim();
  const title  = track.title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim();

  const prompt =
    `Write a cool, energetic, and short radio DJ intro for the next song. ` +
    `Use the ${lang} language. Make it sound like a professional female radio announcer. ` +
    `Only return the spoken text — no quotes, no labels, no extra punctuation. Max 15 words. ` +
    `Song: "${title}" by "${artist}".`;

  const result = await Promise.race([
    scriptModel.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Script timeout')), SCRIPT_TIMEOUT)),
  ]);

  // Strip surrounding quotes the model sometimes adds despite instructions
  return result.response.text().trim().replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '').trim();
}

/**
 * Convert a DJ script to OGG Opus audio via Google Cloud TTS.
 * Returns the audio as a Buffer, or null on failure.
 * @param {string} text
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<Buffer | null>}
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
 * Returns null if either step fails so the caller can skip the intro gracefully.
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<Buffer | null>}
 */
async function announce(track, language) {
  if (!ttsClient || !scriptModel) return null;

  try {
    const script = await generateScript(track, language);
    if (!script) return null;

    console.log(`[DJAnnounce] "${script}"`);
    return await generateTTS(script, language);
  } catch (err) {
    console.error('[DJAnnounce] Pipeline error:', err.message);
    return null;
  }
}

/** @returns {boolean} */
function isReady() { return ttsClient !== null && scriptModel !== null; }

module.exports = { init, announce, isReady };
