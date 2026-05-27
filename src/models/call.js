const supabase = require('../supabase');

async function createCall({ callSid, direction, agentType, fromNumber, toNumber, tenantId }) {
  const { data, error } = await supabase
    .from('calls')
    .insert({
      call_sid: callSid,
      direction,
      agent_type: agentType,
      from_number: fromNumber,
      to_number: toNumber,
      tenant_id: tenantId || null,
      status: 'initiated',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateCall(id, fields) {
  if (!Object.keys(fields).length) return;
  const { data, error } = await supabase.from('calls').update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function updateCallBySid(callSid, fields) {
  if (!Object.keys(fields).length) return;
  const { data, error } = await supabase.from('calls').update(fields).eq('call_sid', callSid).select().single();
  if (error) throw error;
  return data;
}

async function getCallById(id) {
  const { data, error } = await supabase
    .from('calls')
    .select('*, messages(role, content, created_at)')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

async function getCallBySid(callSid) {
  const { data } = await supabase.from('calls').select('*').eq('call_sid', callSid).single();
  return data ? { ...data, callId: data.id } : null;
}

async function listCalls({ tenantId, status, agentType, from, to, limit = 20, offset = 0 } = {}) {
  let query = supabase
    .from('calls')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) query = query.eq('tenant_id', tenantId);
  if (status)    query = query.eq('status', status);
  if (agentType) query = query.eq('agent_type', agentType);
  if (from)      query = query.gte('created_at', from);
  if (to)        query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function appendMessage(callId, role, content) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ call_id: callId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMessages(callId) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('call_id', callId)
    .order('created_at');
  if (error) throw error;
  return data;
}

module.exports = { createCall, updateCall, updateCallBySid, getCallById, getCallBySid, listCalls, appendMessage, getMessages };
