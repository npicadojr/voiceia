const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const tenantModel = require('../models/tenant');
const callModel = require('../models/call');
const twilioService = require('../services/twilio');
const logger = require('../utils/logger');
const { generateAndCacheGreeting } = require('../services/greetingCache');

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
  const allowed = ['name', 'phone_number', 'elevenlabs_voice_id', 'openai_voice', 'human_agent_number', 'active', 'default_agent', 'system_prompt', 'greeting_text', 'google_refresh_token', 'google_calendar_id', 'calendar_provider', 'calendly_api_token', 'calendly_event_type_uri', 'calendly_link', 'email_from', 'timezone'];
  const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  try {
    const tenant = await tenantModel.updateTenant(req.params.id, fields);

    const greetingChanged = 'greeting_text' in fields || 'openai_voice' in fields || 'elevenlabs_voice_id' in fields;
    if (greetingChanged && process.env.BLOB_READ_WRITE_TOKEN) {
      const greetingText = tenant.greeting_text;
      const voice = tenant.openai_voice || 'nova';
      generateAndCacheGreeting(req.params.id, greetingText, voice)
        .then(url => logger.info('Greeting cache refreshed', { tenantId: req.params.id, url }))
        .catch(err => logger.warn('Failed to refresh greeting cache', { tenantId: req.params.id, err: err.message }));
    }

    res.json(tenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/tenants/:id/regenerate-greeting
router.post('/tenants/:id/regenerate-greeting', async (req, res) => {
  try {
    const tenant = await tenantModel.getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const greetingText = tenant.greeting_text;
    if (!greetingText) return res.status(400).json({ error: 'Tenant has no greeting_text configured' });

    const voice = tenant.openai_voice || 'nova';
    const url = await generateAndCacheGreeting(req.params.id, greetingText, voice);
    logger.info('Greeting manually regenerated', { tenantId: req.params.id, url });
    res.json({ url });
  } catch (err) {
    logger.error('Failed to regenerate greeting', { tenantId: req.params.id, err: err.message });
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
