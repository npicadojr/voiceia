/**
 * DB-backed conversation manager — stateless between requests.
 * Works on both local Node.js and Vercel serverless.
 */
const callModel = require('../models/call');
const logger = require('./logger');

async function initConversation(callSid, callId, agentType, metadata = {}) {
  // Call record already created by the route; nothing extra to store.
  logger.info('Conversation initialized', { callSid, agentType });
}

async function addMessage(callSid, role, content) {
  const call = await callModel.getCallBySid(callSid);
  if (!call) { logger.warn('addMessage: call not found', { callSid }); return; }
  await callModel.appendMessage(call.id, role, content);
}

async function addMessageById(callId, role, content) {
  await callModel.appendMessage(callId, role, content);
}

async function getHistoryById(callId) {
  return callModel.getMessages(callId);
}

async function endConversation(callSid, extractedData = null) {
  const call = await callModel.getCallBySid(callSid);
  if (!call) return;
  const fields = { status: 'completed' };
  if (extractedData) fields.extracted_data = extractedData;
  await callModel.updateCall(call.id, fields);
  logger.info('Conversation ended', { callSid });
}

module.exports = {
  initConversation,
  addMessage,
  addMessageById,
  getHistoryById,
  endConversation,
};
