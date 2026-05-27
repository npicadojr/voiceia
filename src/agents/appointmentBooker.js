const { extractStructuredData } = require('../services/openai');
const calendarService = require('../services/calendar');

const SYSTEM_PROMPT = `Eres un asistente especializado en agendar citas y reuniones. Eres eficiente, amable y organizado.

Tu misión:
1. Saluda al usuario y confirma que quiere agendar una cita.
2. Pregunta el propósito de la reunión y su nombre completo.
3. Usa la herramienta get_available_slots para consultar los horarios disponibles de la fecha que pida el usuario.
4. Ofrece los horarios disponibles de forma natural (ej. "Tengo disponible el viernes a las 10am o a las 2pm").
5. Cuando el usuario confirme un horario, pide su email y usa book_appointment para reservar.
6. Confirma la cita reservada con fecha, hora y el email donde llegará la invitación.

Pautas:
- Habla en español, tono profesional y eficiente.
- Respuestas cortas (máximo 2 oraciones).
- Si no hay horarios disponibles, sugiere otra fecha.
- Siempre confirma antes de reservar: "¿Le confirmo la cita el [fecha] a las [hora]?"`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Consulta los horarios disponibles en el calendario para una fecha específica',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD, ej. 2025-06-15' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Reserva una cita en el calendario una vez que el usuario confirmó el horario',
      parameters: {
        type: 'object',
        properties: {
          name:      { type: 'string', description: 'Nombre completo del cliente' },
          email:     { type: 'string', description: 'Email del cliente para la invitación' },
          startTime: { type: 'string', description: 'Fecha y hora de inicio en ISO 8601' },
          purpose:   { type: 'string', description: 'Propósito o tema de la cita' },
        },
        required: ['name', 'startTime'],
      },
    },
  },
];

async function executeToolCall(toolName, args, tenant = {}) {
  if (toolName === 'get_available_slots') {
    const slots = await calendarService.getAvailableSlots(args.date, tenant);
    if (!slots.length) return { available: false, message: 'No hay horarios disponibles para esa fecha.' };
    const formatted = slots.slice(0, 5).map(s => {
      const d = new Date(s);
      return d.toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    });
    return { available: true, slots: formatted, rawSlots: slots.slice(0, 5) };
  }

  if (toolName === 'book_appointment') {
    const event = await calendarService.createEvent({
      title: args.purpose || 'Cita agendada por asistente IA',
      description: `Cliente: ${args.name}${args.email ? ` | Email: ${args.email}` : ''}`,
      startTime: args.startTime,
      attendeeEmail: args.email,
    }, tenant);
    return { booked: true, eventId: event.id, message: `Cita confirmada para ${new Date(args.startTime).toLocaleString('es-MX')}` };
  }

  return { error: `Herramienta desconocida: ${toolName}` };
}

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
    name:      { type: 'string' },
    email:     { type: 'string' },
    purpose:   { type: 'string' },
    startTime: { type: 'string' },
    endTime:   { type: 'string' },
  },
};

function isEndIntent(text) { return END_PATTERNS.some(p => p.test(text)); }
function shouldTransferToHuman(text) { return TRANSFER_PATTERNS.some(p => p.test(text)); }

async function extractBookingData(messages) {
  try { return await extractStructuredData(messages, BOOKING_SCHEMA); } catch { return {}; }
}

module.exports = { SYSTEM_PROMPT, TOOLS, executeToolCall, isEndIntent, shouldTransferToHuman, extractBookingData };
