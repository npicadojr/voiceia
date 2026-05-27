const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

let _openai;
function getClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Download a Twilio recording URL (authenticated) and transcribe with Whisper.
 * @param {string} recordingUrl  — Twilio RecordingUrl (without extension)
 * @returns {Promise<string>}
 */
async function transcribeAudio(recordingUrl) {
  const url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;

  const audioPath = path.join('/tmp/audio', `rec_${uuidv4()}.mp3`);

  const response = await axios.get(url, {
    responseType: 'stream',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(audioPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const transcription = await getClient().audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    language: 'es',
  });

  fs.unlink(audioPath, () => {});
  logger.info('Transcription complete', { length: transcription.text.length });
  return transcription.text;
}

/**
 * Chat with GPT-4o using a system prompt and message history.
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} systemPrompt
 * @returns {Promise<{content:string, usage:object}>}
 */
async function chat(messages, systemPrompt) {
  const full = [{ role: 'system', content: systemPrompt }, ...messages];

  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages: full,
    temperature: 0.7,
    max_tokens: 400,
  });

  const content = completion.choices[0].message.content;
  logger.debug('GPT-4o response', { tokens: completion.usage?.total_tokens });
  return { content, usage: completion.usage };
}

/**
 * Use GPT-4o function calling to extract structured data from a conversation.
 * @param {Array} messages
 * @param {Object} schema   — JSON Schema object describing the data to extract
 * @returns {Promise<Object>}
 */
async function extractStructuredData(messages, schema) {
  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools: [{
      type: 'function',
      function: {
        name: 'extract_data',
        description: 'Extract structured data from the conversation',
        parameters: schema,
      },
    }],
    tool_choice: { type: 'function', function: { name: 'extract_data' } },
  });

  const args = completion.choices[0].message.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : {};
}

module.exports = { transcribeAudio, chat, extractStructuredData };
