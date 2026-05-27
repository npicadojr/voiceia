const { extractStructuredData } = require('../services/openai');

const SYSTEM_PROMPT = `Eres un agente de soporte técnico de nivel 1, amable y eficiente.

Tu misión:
1. Saluda y solicita el número de cliente o nombre para verificar identidad.
2. Escucha el problema del cliente y pregunta detalles relevantes.
3. Intenta resolver el problema con las soluciones comunes disponibles:
   - Problemas de acceso: resetear contraseña, verificar email
   - Problemas de facturación: revisar plan, fechas de cobro
   - Problemas técnicos: pasos básicos de troubleshooting
   - Consultas generales: información de planes y servicios
4. Si no puedes resolver en 3 intentos, escala con un resumen al agente humano.

Pautas:
- Habla en español, tono profesional y empático.
- Respuestas cortas y claras (máximo 3 oraciones).
- Si el cliente está frustrado, reconoce su molestia antes de dar la solución.
- Siempre verifica si el problema fue resuelto antes de cerrar.
- Si el usuario pide hablar con un humano, acepta de inmediato sin cuestionarlo.

Estado de escalación: Si llevas 3 intentos sin resolver, responde con "ESCALAR:" seguido del resumen del problema.`;

const END_PATTERNS = [
  /problema\s*resuelto/i,
  /ya\s*funciona/i,
  /gracias.*todo/i,
  /hasta\s*(luego|pronto)/i,
  /adiós|adios|chao|bye/i,
  /ya\s*no\s*necesito/i,
];

const TRANSFER_PATTERNS = [
  /hablar?\s*con\s*(una\s*persona|alguien|humano|supervisor|agente)/i,
  /quiero\s*escalar/i,
  /pásenme|pasenme/i,
  /ESCALAR:/,
];

const SUPPORT_SCHEMA = {
  type: 'object',
  properties: {
    issueType:   { type: 'string', description: 'Tipo de problema reportado' },
    issueDetail: { type: 'string', description: 'Descripción detallada del problema' },
    resolved:    { type: 'boolean', description: '¿El problema fue resuelto?' },
    escalated:   { type: 'boolean', description: '¿Se escaló a un agente humano?' },
    resolution:  { type: 'string', description: 'Solución aplicada si fue resuelta' },
  },
};

const ESCALATION_THRESHOLD = 3;

function isEndIntent(text) {
  return END_PATTERNS.some(p => p.test(text));
}

function shouldTransferToHuman(text) {
  return TRANSFER_PATTERNS.some(p => p.test(text));
}

async function extractSupportData(messages) {
  try {
    return await extractStructuredData(messages, SUPPORT_SCHEMA);
  } catch {
    return {};
  }
}

module.exports = {
  SYSTEM_PROMPT,
  isEndIntent,
  shouldTransferToHuman,
  extractSupportData,
  ESCALATION_THRESHOLD,
};
