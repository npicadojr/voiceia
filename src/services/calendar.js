const { google } = require('googleapis');
const logger = require('../utils/logger');

function getCalendarClient(tenant = {}) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    refresh_token: tenant.google_refresh_token || process.env.GOOGLE_REFRESH_TOKEN,
  });
  return google.calendar({ version: 'v3', auth });
}

function calendarId(tenant = {}) {
  return tenant.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || 'primary';
}

async function getAvailableSlots(date, tenant = {}) {
  const calendar = getCalendarClient(tenant);
  const calId = calendarId(tenant);

  const day = new Date(date);
  const timeMin = new Date(day.setHours(8, 0, 0, 0)).toISOString();
  const timeMax = new Date(day.setHours(18, 0, 0, 0)).toISOString();

  const { data } = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: calId }] },
  });

  const busy = data.calendars[calId]?.busy ?? [];
  const slots = [];
  let cursor = new Date(timeMin);
  const end = new Date(timeMax);

  while (cursor < end) {
    const slotEnd = new Date(cursor.getTime() + 60 * 60 * 1000);
    const overlaps = busy.some(b => new Date(b.start) < slotEnd && new Date(b.end) > cursor);
    if (!overlaps) slots.push(cursor.toISOString());
    cursor = slotEnd;
  }

  return slots;
}

async function createEvent({ title, description, startTime, endTime, attendeeEmail }, tenant = {}) {
  const calendar = getCalendarClient(tenant);
  const calId = calendarId(tenant);

  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);

  const { data } = await calendar.events.insert({
    calendarId: calId,
    requestBody: {
      summary: title,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
    },
    sendUpdates: 'all',
  });

  logger.info('Calendar event created', { eventId: data.id, startTime, tenantCalendar: calId });
  return data;
}

module.exports = { getAvailableSlots, createEvent };
