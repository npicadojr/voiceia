const { extractStructuredData } = require('../services/openai');
const calendarService = require('../services/calendar');

const SYSTEM_PROMPT = `Eres un asistente especializado en agendar citas y reuniones. Eres eficiente, amable y organizado.

Tu misión:
1. Saluda al usuario y confirma que quiere agendar una cita.
2. Pregunta el propósito de la reunión.
3. Solicita su nombre completo y email para la invitación.
4. Ofrece fechas y horarios disponibles (el sistema te proporcionará los slots disponibles).
5. Confirma el slot elegido y resume la cita antes de finalizar.

Pautas:
- Habla en español, tono profesional y eficiente.
- Respuestas cortas (máximo 2 oraciones).
- Si el usuario no puede asistir en ningún slot disponible, sugiere que llame para reagendar.
- Siempre confirma la cita antes de cerrar: fecha, hora y email donde llegará la invitación.`;

const END_PATTERNS = [
  /hasta\s*(luego|pronto)/i,
  /adiós|adios|chao|bye/i,
  /cita\s*confirmada/i,
  /ya\s*quedamos/i,
  /perfecto.*gracias/i,
];

const TRANSFER_PATTERNS = [
  /hablar?\s*con\s*(una\s*persona|alguien|humano|agente)/i,
  /necesito\s*ayuda\s*especial/i,
  /pásenme|pasenme/i,
];

const BOOKING_SCHEMA = {
  type: 'object',
  properties: {
    name:      { type: 'string', description: 'Nombre completo' },
    email:     { type: 'string', description: 'Email para la invitación' },
    purpose:   { type: 'string', description: 'Propósito o tema de la reunión' },
    startTime: { type: 'string', description: 'Fecha y hora de inicio en ISO 8601' },
    endTime:   { type: 'string', description: 'Fecha y hora de fin en ISO 8601' },
  },
};

function isEndIntent(text) {
  return END_PATTERNS.some(p => p.test(text));
}

function shouldTransferToHuman(text) {
  return TRANSFER_PATTERNS.some(p => p.test(text));
}

async function extractBookingData(messages) {
  try {
    return await extractStructuredData(messages, BOOKING_SCHEMA);
  } catch {
    return {};
  }
}

async function bookAppointment(data) {
  return calendarService.createEvent({
    title: data.purpose || 'Reunión agendada por asistente IA',
    description: `Agendado por asistente de voz. Contacto: ${data.name}`,
    startTime: data.startTime,
    endTime: data.endTime,
    attendeeEmail: data.email,
  });
}

module.exports = { SYSTEM_PROMPT, isEndIntent, shouldTransferToHuman, extractBookingData, bookAppointment };
