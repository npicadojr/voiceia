const { google } = require('googleapis');
const logger = require('../utils/logger');

function getCalendarClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Return available 1-hour slots for a given date (ISO string or YYYY-MM-DD).
 * @param {string} date
 * @returns {Promise<string[]>}  — array of ISO datetime strings
 */
async function getAvailableSlots(date) {
  const calendar = getCalendarClient();
  const day = new Date(date);
  const timeMin = new Date(day.setHours(8, 0, 0, 0)).toISOString();
  const timeMax = new Date(day.setHours(18, 0, 0, 0)).toISOString();

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: process.env.GOOGLE_CALENDAR_ID || 'primary' }],
    },
  });

  const busy = data.calendars[process.env.GOOGLE_CALENDAR_ID || 'primary']?.busy ?? [];

  // Generate all 1-hour slots and filter busy ones
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

/**
 * Create a calendar event.
 * @param {{ title, description, startTime, endTime, attendeeEmail }} details
 * @returns {Promise<object>}
 */
async function createEvent({ title, description, startTime, endTime, attendeeEmail }) {
  const calendar = getCalendarClient();

  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);

  const event = {
    summary: title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
  };

  const { data } = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    requestBody: event,
    sendUpdates: 'all',
  });

  logger.info('Calendar event created', { eventId: data.id, startTime });
  return data;
}

module.exports = { getAvailableSlots, createEvent };
