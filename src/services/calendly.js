const https = require('https');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid Calendly response')); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAvailableSlots(date, tenant = {}) {
  const token = tenant.calendly_api_token;
  const eventTypeUri = tenant.calendly_event_type_uri;
  if (!token || !eventTypeUri) return [];

  const startTime = `${date}T00:00:00.000000Z`;
  const endTime   = `${date}T23:59:59.000000Z`;
  const qs = `event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;

  const data = await request({
    hostname: 'api.calendly.com',
    path: `/event_type_available_times?${qs}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  return (data.collection || []).slice(0, 5).map(t => t.start_time);
}

async function createEvent({ name, email, startTime, purpose }, tenant = {}) {
  const token = tenant.calendly_api_token;
  const eventTypeUri = tenant.calendly_event_type_uri;
  if (!token || !eventTypeUri) throw new Error('Calendly no configurado para este cliente');

  const body = JSON.stringify({ max_event_count: 1, owner: eventTypeUri, owner_type: 'EventType' });
  const data = await request({
    hostname: 'api.calendly.com',
    path: '/scheduling_links',
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  const baseLink = data.resource?.booking_url;
  const prefilled = baseLink
    ? `${baseLink}?email=${encodeURIComponent(email || '')}&name=${encodeURIComponent(name || '')}`
    : null;
  return {
    booked: false,
    schedulingLink: prefilled || baseLink,
    name,
    email,
    message: prefilled
      ? `Perfecto, le enviaré el link a su correo para confirmar la cita.`
      : 'No pude generar el link de reserva, contacta directamente.',
  };
}

module.exports = { getAvailableSlots, createEvent };
