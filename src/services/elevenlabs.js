const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

async function fetchAudioStream(text, voiceId) {
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID;
  return axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voice}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'stream',
    }
  );
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Convert text to speech.
 * - On Vercel (BLOB_READ_WRITE_TOKEN set): uploads to Vercel Blob, returns public URL.
 * - Locally: saves to /tmp/audio and serves via Express static.
 */
async function textToSpeech(text, voiceId) {
  const fileId = uuidv4();
  const response = await fetchAudioStream(text, voiceId);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Vercel Blob path
    const { put } = require('@vercel/blob');
    const buffer = await streamToBuffer(response.data);
    const { url } = await put(`audio/${fileId}.mp3`, buffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    });
    logger.info('ElevenLabs TTS → Vercel Blob', { fileId });
    return { fileId, url };
  }

  // Local path — save to /tmp/audio, served as static
  const dir = '/tmp/audio';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${fileId}.mp3`);

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const url = `${process.env.BASE_URL}/audio/${fileId}.mp3`;
  logger.info('ElevenLabs TTS → /tmp/audio', { fileId });
  return { fileId, filePath, url };
}

function deleteAudioFile(fileId) {
  const filePath = path.join('/tmp/audio', `${fileId}.mp3`);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') logger.warn('Failed to delete audio', { fileId });
  });
}

module.exports = { textToSpeech, deleteAudioFile };
