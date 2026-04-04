'use strict';

const textToSpeech = require('@google-cloud/text-to-speech');

const TTS_TIMEOUT = 8_000;

// Voice configs per language — Wavenet female voices
const VOICES = {
  indonesian: { languageCode: 'id-ID', name: 'id-ID-Wavenet-A', ssmlGender: 'FEMALE' },
  english:    { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' },
};

const DJ_SCRIPTS = {
  indonesian: [
    "Dan sekarang, mari kita dengarkan {title} dari {artist}!",
    "Tetap di sini, lagu selanjutnya ada {title} by {artist}!",
    "Lanjut terus! Ini dia {title} dari {artist}.",
    "Buat yang lagi santai, pas banget nih. Kita puterin {title} dari {artist}.",
    "Jangan kemana-mana, karena abis ini ada {artist} dengan lagunya, {title}.",
    "Naikin volume kalian! Ini dia {title} dari {artist}.",
    "Lagu berikutnya pasti udah nggak asing lagi. Langsung aja, {artist} dengan {title}.",
    "Masih nemenin kalian di sini. Selanjutnya, {title} dibawakan oleh {artist}.",
    "Siap-siap sing along, karena ini dia {title} dari {artist}.",
    "Berikutnya ada track asik dari {artist}, judulnya {title}.",
    "Biar makin semangat, kita dengerin dulu {title} dari {artist}.",
    "Satu lagu spesial buat kalian, {title} dari {artist}.",
    "Habis yang satu ini, kita langsung gas ke {title} by {artist}.",
    "Tetap di frekuensi yang sama, selanjutnya ada {artist} membawakan {title}.",
    "Lagu yang pas banget buat momen ini. Ini dia {title} dari {artist}.",
    "Jangan kasih kendor! Langsung aja kita putar {title} dari {artist}.",
    "Pilihan mantap nih. Kita dengerin bareng-bareng, {artist} dengan {title}.",
    "Track selanjutnya jatuh kepada... {title} dari {artist}!",
    "Oke, mari kita nikmati alunan {title} yang dibawakan spesial oleh {artist}.",
    "Mengudara selanjutnya, sebuah karya dari {artist} berjudul {title}.",
  ],
  english: [
    "Up next, {title} by {artist}!",
    "Here it comes — {title} from {artist}!",
    "Get ready for {title} by {artist}!",
    "Next up on the playlist, {title} by {artist}!",
    "Stay tuned — coming up next is {title} by {artist}.",
    "Turn it up! Here's {title} from {artist}.",
    "You won't want to miss this one. {artist} with {title}.",
    "Keep it locked in. Next track: {title} by {artist}.",
    "Sing along if you know the words — it's {title} by {artist}.",
    "A great pick coming your way. {artist} performing {title}.",
    "Let's keep the energy going with {title} from {artist}.",
    "A special one for you all — {title} by {artist}.",
    "No stopping now! Rolling straight into {title} by {artist}.",
    "Stay on the same frequency. Next up, {artist} with {title}.",
    "Perfect track for this moment. Here's {title} from {artist}.",
    "Don't touch that dial! Here comes {title} by {artist}.",
    "A solid choice. Let's enjoy {artist} with {title}.",
    "And the next track goes to... {title} by {artist}!",
    "Sit back and enjoy {title}, brought to you by {artist}.",
    "On air next — a track by {artist} titled {title}.",
  ],
};

/** @type {import('@google-cloud/text-to-speech').TextToSpeechClient | null} */
let ttsClient = null;

/**
 * Call once at startup. Silently disables if TTS credentials are missing.
 */
function init() {
  const ttsKey = process.env.GOOGLE_CLOUD_TTS_KEY;
  if (!ttsKey) {
    console.log('[DJAnnounce] Disabled — set GOOGLE_CLOUD_TTS_KEY to enable.');
    return;
  }

  try {
    ttsClient = new textToSpeech.TextToSpeechClient({
      credentials: JSON.parse(ttsKey),
    });
    console.log('[DJAnnounce] Ready.');
  } catch (err) {
    console.error('[DJAnnounce] Init failed:', err.message);
  }
}

/**
 * Clean a track title/artist for natural TTS reading.
 * Strips "(Official Video)", "[Lyrics]", "- Topic", etc.
 * @param {string} text
 * @returns {string}
 */
function cleanForSpeech(text) {
  return text
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/\b(lyrics?|official\s+(music\s+)?video|official\s+audio|music\s+video|audio|mv|hd|4k|visualizer|lyric\s+video|lirik(\s+lagu)?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Pick a random DJ script template, fill in track metadata, and return the
 * final spoken string.
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {string}
 */
function generateScript(track, language) {
  const scripts  = DJ_SCRIPTS[language] ?? DJ_SCRIPTS.english;
  const template = scripts[Math.floor(Math.random() * scripts.length)];
  const title    = cleanForSpeech(track.title);
  const artist   = cleanForSpeech(track.uploader);
  return template.replace(/\{title\}/g, title).replace(/\{artist\}/g, artist);
}

/**
 * Convert a script string to OGG Opus audio via Google Cloud TTS.
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
 * Full pipeline: pick a random script → synthesise TTS → return audio Buffer.
 * Returns null if TTS fails so the caller can skip the intro gracefully.
 * @param {{ title: string, uploader: string }} track
 * @param {'indonesian' | 'english'} language
 * @returns {Promise<Buffer | null>}
 */
async function announce(track, language) {
  if (!ttsClient) return null;

  try {
    const script = generateScript(track, language);
    console.log(`[DJAnnounce] "${script}"`);
    return await generateTTS(script, language);
  } catch (err) {
    console.error('[DJAnnounce] Pipeline error:', err.message);
    return null;
  }
}

/** @returns {boolean} */
function isReady() { return ttsClient !== null; }

module.exports = { init, announce, isReady };
