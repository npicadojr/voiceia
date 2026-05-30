const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Readable } = require('stream');
const OpenAI = require('openai');
const logger = require('../utils/logger');

let _openai;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// GET /audio/:token — stream OpenAI TTS audio to Twilio
router.get('/:token', async (req, res) => {
  const token = req.params.token;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return res.sendStatus(403);

  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const expected = crypto
    .createHmac('sha256', process.env.AUDIO_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 16);

  if (sig !== expected) {
    logger.warn('Invalid audio token signature');
    return res.sendStatus(403);
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return res.sendStatus(403);
  }

  if (Date.now() - parsed.ts > 60_000) {
    return res.sendStatus(410);
  }

  try {
    const response = await getClient().audio.speech.create({
      model: 'tts-1',
      voice: parsed.voice || 'nova',
      input: parsed.text,
      response_format: 'mp3',
    });

    res.set('Content-Type', 'audio/mpeg');
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    logger.error('OpenAI TTS streaming failed', { err: err.message });
    res.sendStatus(500);
  }
});

module.exports = router;
