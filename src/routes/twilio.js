const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const openaiService  = require('../services/openai');
const elevenlabsService = require('../services/elevenlabs');
const callModel      = require('../models/call');
const leadModel      = require('../models/lead');
const tenantModel    = require('../models/tenant');
const conversationManager = require('../utils/conversationManager');
const emailService   = require('../services/email');
const logger         = require('../utils/logger');

const AGENTS = {
  leadQualifier:     require('../agents/leadQualifier'),
  appointmentBooker: require('../agents/appointmentBooker'),
  surveyor:          require('../agents/surveyor'),
  support:           require('../agents/support'),
};

const DEFAULT_GREETINGS = {
  leadQualifier:    '¡Hola! Soy Ana, asistente de ventas. ¿Me podría dar un momento de su tiempo para contarle sobre nuestras soluciones?',
  appointmentBooker:'¡Buenos días! Soy el asistente de agenda. Estoy aquí para ayudarle a programar una cita. ¿Cuándo le vendría bien reunirse?',
  surveyor:         'Hola, soy el asistente de satisfacción al cliente. Le haré algunas preguntas breves sobre su experiencia. ¿Tiene un par de minutos?',
  support:          'Bienvenido al soporte técnico. Soy su asistente virtual. ¿En qué le puedo ayudar hoy?',
};

async function resolveTenant(slug) {
  if (!slug) return null;
  return tenantModel.getTenantBySlug(slug);
}

// POST /twilio/voice
router.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid    = req.body.CallSid;
  const fromNumber = req.body.From || req.body.Caller;
  const toNumber   = req.body.To   || req.body.Called;
  const direction  = req.query.direction || (req.body.Direction === 'outbound-api' ? 'outbound' : 'inbound');

  try {
    const tenant = await resolveTenant(req.query.tenant);
    const agentType  = req.query.agent || tenant?.default_agent || 'leadQualifier';

    const greetingText = tenant?.greeting_text || DEFAULT_GREETINGS[agentType] || DEFAULT_GREETINGS.appointmentBooker;
    const voiceId      = tenant?.elevenlabs_voice_id || undefined;

    const callRecord = await callModel.createCall({
      callSid, direction, agentType, fromNumber, toNumber,
      tenantId: tenant?.id || null,
    });

    await conversationManager.initConversation(callSid, callRecord.id, agentType, { fromNumber, toNumber });
    await conversationManager.addMessage(callSid, 'assistant', greetingText);

    let audioUrl;
    try {
      const tts = await elevenlabsService.textToSpeech(greetingText, voiceId);
      audioUrl = tts.url;
    } catch (err) {
      logger.warn('ElevenLabs failed, falling back to Twilio Say', { err: err.message });
    }

    if (audioUrl) twiml.play(audioUrl);
    else twiml.say({ language: 'es-MX' }, greetingText);

    twiml.record({
      action: `${process.env.BASE_URL}/twilio/transcribe`,
      method: 'POST',
      maxLength: 30,
      timeout: 5,
      playBeep: false,
      trim: 'trim-silence',
    });

    twiml.say({ language: 'es-MX' }, 'No detecté ninguna respuesta. Hasta luego.');
    twiml.hangup();

  } catch (err) {
    logger.error('Error in /twilio/voice', { callSid, err: err.message });
    twiml.say({ language: 'es-MX' }, 'Lo siento, ocurrió un error. Por favor intente de nuevo.');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

// POST /twilio/transcribe
router.post('/transcribe', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid       = req.body.CallSid;
  const recordingUrl  = req.body.RecordingUrl;
  const recordingStatus = req.body.RecordingStatus;

  if (recordingStatus === 'no-audio' || !recordingUrl) {
    twiml.say({ language: 'es-MX' }, 'No escuché nada. ¿Podría repetir?');
    twiml.record({ action: `${process.env.BASE_URL}/twilio/transcribe`, method: 'POST', maxLength: 30, timeout: 5, playBeep: false, trim: 'trim-silence' });
    return res.type('text/xml').send(twiml.toString());
  }

  const agentType = await conversationManager.getAgentType(callSid);
  const agent = AGENTS[agentType] || AGENTS.leadQualifier;

  try {
    // Resolve tenant for voice/prompt overrides
    const callRecord = await callModel.getCallBySid(callSid);
    const tenant = callRecord?.tenant_id ? await tenantModel.getTenantById(callRecord.tenant_id) : null;
    const systemPrompt = tenant?.system_prompt || agent.SYSTEM_PROMPT;
    const voiceId = tenant?.elevenlabs_voice_id || undefined;

    const userText = await openaiService.transcribeAudio(recordingUrl);
    logger.info('User said', { callSid, text: userText });
    await conversationManager.addMessage(callSid, 'user', userText);

    if (agent.shouldTransferToHuman(userText)) {
      const ctx = await conversationManager.getConversation(callSid);
      await callModel.updateCall(ctx.callId, { status: 'transferred' });
      await conversationManager.endConversation(callSid);

      twiml.say({ language: 'es-MX' }, 'Por supuesto, le transfiero con un agente humano. Un momento por favor.');
      const dial = twiml.dial({ action: `${process.env.BASE_URL}/twilio/transfer-complete`, method: 'POST' });
      dial.number(tenant?.human_agent_number || process.env.HUMAN_AGENT_NUMBER || process.env.TWILIO_PHONE_NUMBER);
      return res.type('text/xml').send(twiml.toString());
    }

    if (agent.isEndIntent(userText)) {
      const history = await conversationManager.getHistory(callSid);
      let extractedData = {};
      const extractFn = agent.extractLeadData || agent.extractBookingData || agent.extractSurveyResults || agent.extractSupportData;
      if (extractFn) extractedData = await extractFn(history);

      if (agentType === 'leadQualifier' && extractedData.phone) {
        const ctx = await conversationManager.getConversation(callSid);
        await leadModel.upsertLead({ ...extractedData, sourceCallId: ctx.callId, tenantId: callRecord?.tenant_id });
      }

      await conversationManager.endConversation(callSid, extractedData);

      const farewellText = 'Fue un placer hablar con usted. ¡Que tenga un excelente día! Hasta luego.';
      let audioUrl;
      try { const tts = await elevenlabsService.textToSpeech(farewellText, voiceId); audioUrl = tts.url; } catch {}

      if (audioUrl) twiml.play(audioUrl);
      else twiml.say({ language: 'es-MX' }, farewellText);
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const history = await conversationManager.getHistory(callSid);

    // Use tool calling for appointmentBooker, plain chat for others
    let aiResponse;
    if (agentType === 'appointmentBooker' && agent.TOOLS) {
      const provider = tenant?.calendar_provider || 'google';
      const calendarNote =
        provider === 'calendly_free'
          ? '\nNo consultes disponibilidad. Solo pide el nombre completo y el correo del cliente, luego llama send_booking_link. Dile que recibirá un email con el link para elegir su horario.'
          : provider === 'calendly'
          ? '\nPide el email antes de confirmar. Con nombre, horario y email confirmado usa book_appointment. El cliente recibirá el link por email.'
          : '\nPide el email antes de confirmar: "¿A qué email le envío la invitación?". Repítelo deletreándolo y espera confirmación.';
      const appointmentPrompt = systemPrompt + calendarNote;
      const tools = provider === 'calendly_free' ? agent.TOOLS_FREE_CALENDLY : agent.TOOLS;
      const result = await openaiService.chatWithTools(history, appointmentPrompt, tools);

      if (result.toolCalls) {
        // Execute each tool call and build updated messages for re-call
        const updatedMessages = [...history, result.assistantMessage];
        for (const tc of result.toolCalls) {
          logger.info('Tool call', { callSid, tool: tc.name, args: tc.args });
          let toolResult;
          try {
            toolResult = await agent.executeToolCall(tc.name, tc.args, tenant);
          } catch (err) {
            logger.error('Tool call failed', { callSid, tool: tc.name, err: err.message });
            toolResult = { error: 'No pude consultar el calendario en este momento. Por favor intenta de nuevo.' };
          }
          // Send email with Calendly link
          if (toolResult.schedulingLink && toolResult.email) {
            try {
              await emailService.sendBookingLink({
                toEmail: toolResult.email,
                toName: toolResult.name,
                link: toolResult.schedulingLink,
                tenantName: tenant?.name,
                fromEmail: tenant?.email_from,
              });
              logger.info('Email sent with Calendly link', { callSid, to: toolResult.email });
            } catch (emailErr) {
              logger.warn('Failed to send email', { callSid, err: emailErr.message });
            }
          }
          updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
          await conversationManager.addMessage(callSid, 'tool', JSON.stringify(toolResult));
        }
        // Re-call GPT-4o without tools to get the natural language response
        const final = await openaiService.chat(
          updatedMessages.filter(m => m.role !== 'system'),
          appointmentPrompt
        );
        aiResponse = final.content;
      } else {
        aiResponse = result.content;
      }
    } else {
      const result = await openaiService.chat(history, systemPrompt);
      aiResponse = result.content;
    }

    logger.info('AI response', { callSid, text: aiResponse });
    await conversationManager.addMessage(callSid, 'assistant', aiResponse);

    let audioUrl;
    try { const tts = await elevenlabsService.textToSpeech(aiResponse, voiceId); audioUrl = tts.url; } catch (err) {
      logger.warn('ElevenLabs TTS failed', { err: err.message });
    }

    if (audioUrl) twiml.play(audioUrl);
    else twiml.say({ language: 'es-MX' }, aiResponse);

    twiml.record({ action: `${process.env.BASE_URL}/twilio/transcribe`, method: 'POST', maxLength: 30, timeout: 5, playBeep: false, trim: 'trim-silence' });
    twiml.say({ language: 'es-MX' }, '¿Sigue ahí? Si necesita algo más, no dude en llamar. Hasta luego.');
    twiml.hangup();

  } catch (err) {
    logger.error('Error in /twilio/transcribe', { callSid, err: err.message });
    twiml.say({ language: 'es-MX' }, 'Lo siento, ocurrió un error procesando su respuesta. Por favor intente de nuevo.');
    twiml.record({ action: `${process.env.BASE_URL}/twilio/transcribe`, method: 'POST', maxLength: 30, timeout: 5 });
  }

  res.type('text/xml').send(twiml.toString());
});

// POST /twilio/status
router.post('/status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  logger.info('Call status update', { CallSid, CallStatus });
  try {
    const fields = { status: mapTwilioStatus(CallStatus) };
    if (CallDuration) fields.duration_seconds = parseInt(CallDuration, 10);
    if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) fields.ended_at = new Date().toISOString();
    await callModel.updateCallBySid(CallSid, fields);
  } catch (err) {
    logger.error('Failed to update call status', { CallSid, err: err.message });
  }
  res.sendStatus(204);
});

function mapTwilioStatus(status) {
  const map = { 'initiated':'initiated', 'ringing':'ringing', 'in-progress':'in-progress', 'completed':'completed', 'failed':'failed', 'busy':'busy', 'no-answer':'no-answer' };
  return map[status] || 'initiated';
}

module.exports = router;
