const supabase = require('../supabase');
const { generateApiKey } = require('../utils/apiKey');

async function createTenant({ name, slug, phoneNumber, voiceId, humanAgentNumber, defaultAgent, googleRefreshToken, googleCalendarId, systemPrompt, greetingText, calendarProvider, calendlyApiToken, calendlyEventTypeUri, timezone }) {
  const apiKey = generateApiKey();
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      name,
      slug: slug.toLowerCase().replace(/\s+/g, '-'),
      phone_number: phoneNumber,
      elevenlabs_voice_id: voiceId || process.env.ELEVENLABS_VOICE_ID,
      human_agent_number: humanAgentNumber,
      default_agent: defaultAgent || 'appointmentBooker',
      system_prompt: systemPrompt || null,
      greeting_text: greetingText || null,
      google_refresh_token: googleRefreshToken || null,
      google_calendar_id: googleCalendarId || 'primary',
      calendar_provider: calendarProvider || 'google',
      calendly_api_token: calendlyApiToken || null,
      calendly_event_type_uri: calendlyEventTypeUri || null,
      timezone: timezone || 'America/Panama',
      api_key: apiKey,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getTenantById(id) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*, agent_configs(*)')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

async function getTenantBySlug(slug) {
  const { data } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single();
  return data || null;
}

async function getTenantByApiKey(apiKey) {
  const { data } = await supabase
    .from('tenants')
    .select('*')
    .eq('api_key', apiKey)
    .single();
  return data || null;
}

async function updateTenant(id, fields) {
  const { data, error } = await supabase
    .from('tenants')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deactivateTenant(id) {
  return updateTenant(id, { active: false });
}

async function upsertAgentConfig(tenantId, agentType, { systemPrompt, greetingText }) {
  const { data, error } = await supabase
    .from('agent_configs')
    .upsert(
      { tenant_id: tenantId, agent_type: agentType, system_prompt: systemPrompt, greeting_text: greetingText },
      { onConflict: 'tenant_id,agent_type' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getAgentConfig(tenantId, agentType) {
  const { data } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('agent_type', agentType)
    .single();
  return data || null;
}

module.exports = {
  createTenant, listTenants, getTenantById, getTenantBySlug,
  getTenantByApiKey, updateTenant, deactivateTenant,
  upsertAgentConfig, getAgentConfig,
};
