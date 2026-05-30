const twilio = require('twilio');
const logger = require('../utils/logger');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Initiate an outbound call.
 * @param {string} to           — E.164 destination number
 * @param {string} agentType
 * @param {string} tenantSlug   — used to route webhook to the right tenant config
 * @param {object} metadata
 */
async function initiateCall(to, agentType = 'leadQualifier', tenantSlug = null, metadata = {}) {
  const params = new URLSearchParams({ agent: agentType });
  if (tenantSlug) params.set('tenant', tenantSlug);
  Object.entries(metadata).forEach(([k, v]) => params.set(k, v));

  const call = await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${process.env.BASE_URL}/twilio/voice?${params}`,
    statusCallback: `${process.env.BASE_URL}/twilio/status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });

  logger.info('Outbound call initiated', { callSid: call.sid, to, agentType, tenantSlug });
  return call;
}

async function redirectCall(callSid, twimlUrl) {
  return client.calls(callSid).update({ url: twimlUrl, method: 'POST' });
}

module.exports = { initiateCall, redirectCall };
