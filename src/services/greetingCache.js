const OpenAI = require('openai');
const { put, list } = require('@vercel/blob');
const logger = require('../utils/logger');

let _openai;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

async function generateAndCacheGreeting(tenantId, greetingText, voice = 'nova') {
  const response = await getClient().audio.speech.create({
    model: 'tts-1',
    voice,
    input: greetingText,
    response_format: 'mp3',
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  const { url } = await put(`greeting-${tenantId}.mp3`, buffer, {
    access: 'public',
    contentType: 'audio/mpeg',
    addRandomSuffix: false,
  });

  logger.info('Greeting cached in Vercel Blob', { tenantId, url });
  return url;
}

async function getGreetingUrl(tenantId) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { blobs } = await list({ prefix: `greeting-${tenantId}.mp3` });
    return blobs.length > 0 ? blobs[0].url : null;
  } catch (err) {
    logger.warn('Failed to check greeting blob', { tenantId, err: err.message });
    return null;
  }
}

module.exports = { generateAndCacheGreeting, getGreetingUrl };
