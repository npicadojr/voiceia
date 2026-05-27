const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const tenantModel = require('../models/tenant');
const callModel = require('../models/call');
const twilioService = require('../services/twilio');
const logger = require('../utils/logger');

router.use(adminAuth);

// POST /admin/tenants
router.post('/tenants', async (req, res) => {
  const { name, slug, phoneNumber, voiceId, humanAgentNumber, defaultAgent, googleRefreshToken, googleCalendarId } = req.body;
  if (!name || !slug) return res.status(400).json({ error: '`name` and `slug` are required' });

  try {
    const tenant = await tenantModel.createTenant({ name, slug, phoneNumber, voiceId, humanAgentNumber, defaultAgent, googleRefreshToken, googleCalendarId });
    res.status(201).json(tenant);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'slug already exists' });
    logger.error('Failed to create tenant', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/tenants
router.get('/tenants', async (req, res) => {
  try {
    const tenants = await tenantModel.listTenants();
    res.json({ tenants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/tenants/:id
router.get('/tenants/:id', async (req, res) => {
  try {
    const tenant = await tenantModel.getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/tenants/:id
router.put('/tenants/:id', async (req, res) => {
  const allowed = ['name', 'phone_number', 'elevenlabs_voice_id', 'human_agent_number', 'active', 'default_agent', 'google_refresh_token', 'google_calendar_id'];
  const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  try {
    const tenant = await tenantModel.updateTenant(req.params.id, fields);
    res.json(tenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/tenants/:id
router.delete('/tenants/:id', async (req, res) => {
  try {
    await tenantModel.deactivateTenant(req.params.id);
    res.json({ message: 'Tenant deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/tenants/:id/agents/:type
router.put('/tenants/:id/agents/:type', async (req, res) => {
  const valid = ['leadQualifier', 'appointmentBooker', 'surveyor', 'support'];
  if (!valid.includes(req.params.type)) {
    return res.status(400).json({ error: `Invalid agent type. Must be one of: ${valid.join(', ')}` });
  }
  const { systemPrompt, greetingText } = req.body;
  try {
    const config = await tenantModel.upsertAgentConfig(req.params.id, req.params.type, { systemPrompt, greetingText });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/tenants/:id/calls
router.get('/tenants/:id/calls', async (req, res) => {
  const { status, agent, limit = 20, offset = 0 } = req.query;
  try {
    const calls = await callModel.listCalls({
      tenantId: req.params.id,
      status,
      agentType: agent,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
      offset: parseInt(offset, 10) || 0,
    });
    res.json({ calls, count: calls.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/tenants/:id/calls/outbound
router.post('/tenants/:id/calls/outbound', async (req, res) => {
  const { to, agent = 'leadQualifier' } = req.body;
  if (!to) return res.status(400).json({ error: '`to` is required' });

  try {
    const tenant = await tenantModel.getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const call = await twilioService.initiateCall(to, agent, tenant.slug);
    const dbRecord = await callModel.createCall({
      callSid: call.sid,
      direction: 'outbound',
      agentType: agent,
      fromNumber: tenant.phone_number,
      toNumber: to,
      tenantId: tenant.id,
    });
    res.status(201).json({ callSid: call.sid, id: dbRecord.id, status: 'initiated' });
  } catch (err) {
    logger.error('Failed outbound call', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
