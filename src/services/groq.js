const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

let _groq;
function getClient() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// Simple agents use fast 8b model; tool-calling agents need the 70b
const FAST_MODEL = 'llama-3.1-8b-instant';
const SMART_MODEL = 'llama-3.3-70b-versatile';

async function transcribeAudio(recordingUrl) {
  const url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;

  const audioPath = path.join('/tmp/audio', `rec_${uuidv4()}.mp3`);
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });

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
    model: 'whisper-large-v3-turbo',
    language: 'es',
  });

  fs.unlink(audioPath, () => {});
  logger.info('Groq transcription complete', { length: transcription.text.length });
  return transcription.text;
}

async function chat(messages, systemPrompt) {
  const full = [{ role: 'system', content: systemPrompt }, ...messages];

  const completion = await getClient().chat.completions.create({
    model: FAST_MODEL,
    messages: full,
    temperature: 0.7,
    max_tokens: 150,
  });

  const content = completion.choices[0].message.content;
  logger.debug('Groq chat response', { model: FAST_MODEL, tokens: completion.usage?.total_tokens });
  return { content, usage: completion.usage };
}

async function chatWithTools(messages, systemPrompt, tools) {
  const full = [{ role: 'system', content: systemPrompt }, ...messages];

  const completion = await getClient().chat.completions.create({
    model: SMART_MODEL,
    messages: full,
    tools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: 150,
  });

  const choice = completion.choices[0];

  if (choice.finish_reason === 'tool_calls') {
    const toolCalls = choice.message.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));
    return { toolCalls, assistantMessage: choice.message };
  }

  return { content: choice.message.content };
}

// extractStructuredData uses OpenAI gpt-4o — keep that import available as fallback
async function extractStructuredData(messages, schema) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
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

module.exports = { transcribeAudio, chat, chatWithTools, extractStructuredData };
