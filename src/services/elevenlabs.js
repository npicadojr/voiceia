const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const OPENAI_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);

function resolveVoice(voiceId) {
  if (voiceId && OPENAI_VOICES.has(voiceId)) return voiceId;
  return process.env.OPENAI_TTS_VOICE || 'nova';
}

let _openai;
function getClient() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

async function textToSpeech(text, voiceId) {
  const fileId = uuidv4();
  const voice = resolveVoice(voiceId);

  const openai = getClient();
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const { url } = await put(`audio/${fileId}.mp3`, buffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    });
    logger.info('OpenAI TTS → Vercel Blob', { fileId, voice });
    return { fileId, url };
  }

  const dir = '/tmp/audio';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${fileId}.mp3`);
  fs.writeFileSync(filePath, buffer);

  const url = `${process.env.BASE_URL}/audio/${fileId}.mp3`;
  logger.info('OpenAI TTS → /tmp/audio', { fileId, voice });
  return { fileId, filePath, url };
}

function deleteAudioFile(fileId) {
  const filePath = path.join('/tmp/audio', `${fileId}.mp3`);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') logger.warn('Failed to delete audio', { fileId });
  });
}

module.exports = { textToSpeech, deleteAudioFile };
