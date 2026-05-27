const supabase = require('../supabase');

async function upsertLead({ phone, name, email, company, interestLevel, budget, timeline, notes, sourceCallId, tenantId }) {
  const existing = await getLeadByPhone(phone, tenantId);

  const record = {
    phone,
    tenant_id:      tenantId       ?? existing?.tenant_id,
    name:           name           ?? existing?.name,
    email:          email          ?? existing?.email,
    company:        company        ?? existing?.company,
    interest_level: interestLevel  ?? existing?.interest_level,
    budget:         budget         ?? existing?.budget,
    timeline:       timeline       ?? existing?.timeline,
    notes:          notes          ?? existing?.notes,
    source_call_id: sourceCallId   ?? existing?.source_call_id,
    updated_at:     new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('leads')
    .upsert(record, { onConflict: 'phone' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getLeadByPhone(phone, tenantId) {
  let query = supabase.from('leads').select('*').eq('phone', phone);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data } = await query.single();
  return data || null;
}

module.exports = { upsertLead, getLeadByPhone };
