const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const twilioService = require('../services/twilio');
const callModel = require('../models/call');
const logger = require('../utils/logger');

// POST /calls/outbound — Initiate an outbound call
router.post('/outbound', async (req, res) => {
  const { to, agent = 'leadQualifier', metadata = {} } = req.body;

  if (!to) {
    return res.status(400).json({ error: '`to` phone number is required' });
  }
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return res.status(400).json({ error: '`to` must be a valid E.164 number (e.g. +12125551234)' });
  }

  const validAgents = ['leadQualifier', 'appointmentBooker', 'surveyor', 'support'];
  if (!validAgents.includes(agent)) {
    return res.status(400).json({ error: `Invalid agent. Must be one of: ${validAgents.join(', ')}` });
  }

  try {
    const call = await twilioService.initiateCall(to, agent, metadata);

    const dbRecord = await callModel.createCall({
      callSid: call.sid,
      direction: 'outbound',
      agentType: agent,
      fromNumber: process.env.TWILIO_PHONE_NUMBER,
      toNumber: to,
    });

    res.status(201).json({ callSid: call.sid, id: dbRecord.id, status: 'initiated', agent, to });
  } catch (err) {
    logger.error('Failed to initiate outbound call', { err: err.message, to });
    res.status(500).json({ error: 'Failed to initiate call', detail: err.message });
  }
});

// GET /calls — List calls with filters
router.get('/', async (req, res) => {
  const { status, agent, from, to, limit = 20, offset = 0 } = req.query;

  try {
    const calls = await callModel.listCalls({
      status,
      agentType: agent,
      from,
      to,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
      offset: parseInt(offset, 10) || 0,
    });
    res.json({ calls, count: calls.length });
  } catch (err) {
    logger.error('Failed to list calls', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

// GET /calls/:id — Call detail with messages
router.get('/:id', async (req, res) => {
  try {
    const call = await callModel.getCallById(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (err) {
    logger.error('Failed to get call', { id: req.params.id, err: err.message });
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

// POST /calls/:id/transfer — Transfer active call to human
router.post('/:id/transfer', async (req, res) => {
  const { transferTo } = req.body;

  if (!transferTo && !process.env.HUMAN_AGENT_NUMBER) {
    return res.status(400).json({ error: '`transferTo` number is required' });
  }

  try {
    const call = await callModel.getCallById(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    if (call.status !== 'in-progress') {
      return res.status(409).json({ error: 'Call is not in progress' });
    }

    const twiml = new VoiceResponse();
    twiml.say({ language: 'es-MX' }, 'Transfiriendo su llamada con un agente humano. Un momento por favor.');
    const dial = twiml.dial();
    dial.number(transferTo || process.env.HUMAN_AGENT_NUMBER);

    await twilioService.redirectCall(call.call_sid, `${process.env.BASE_URL}/twilio/transfer?twiml=1`);
    await callModel.updateCall(call.id, { status: 'transferred' });

    res.json({ message: 'Transfer initiated', callSid: call.call_sid });
  } catch (err) {
    logger.error('Failed to transfer call', { id: req.params.id, err: err.message });
    res.status(500).json({ error: 'Failed to transfer call', detail: err.message });
  }
});

module.exports = router;
