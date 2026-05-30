const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const ELEVENLABS_API  = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE   = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah (multilingual)
const DEFAULT_MODEL   = process.env.ELEVENLABS_MODEL    || 'eleven_multilingual_v2';

async function textToSpeech(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const voice  = voiceId || DEFAULT_VOICE;
  const fileId = uuidv4();

  const response = await fetch(`${ELEVENLABS_API}/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: DEFAULT_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const { url } = await put(`audio/${fileId}.mp3`, buffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    });
    logger.info('ElevenLabs TTS → Vercel Blob', { fileId, voice });
    return { fileId, url };
  }

  const dir = '/tmp/audio';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${fileId}.mp3`);
  fs.writeFileSync(filePath, buffer);

  const url = `${process.env.BASE_URL}/audio/${fileId}.mp3`;
  logger.info('ElevenLabs TTS → /tmp/audio', { fileId, voice });
  return { fileId, filePath, url };
}

module.exports = { textToSpeech };
