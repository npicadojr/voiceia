const { extractStructuredData } = require('../services/openai');

const SYSTEM_PROMPT = `Eres un asistente de ventas profesional y amigable. Tu objetivo es calificar a los leads de forma natural y conversacional.

Tu misión:
1. Saluda al prospecto y preséntate brevemente.
2. Descubre cuál es su necesidad o problema principal.
3. Recopila esta información de forma natural (no como un interrogatorio):
   - Nombre completo
   - Empresa u organización
   - Email de contacto
   - Presupuesto aproximado
   - Plazo para tomar una decisión
   - Nivel de interés (alto, medio, bajo)
4. Ofrece información relevante sobre los beneficios del producto/servicio.
5. Si el prospecto está listo, agenda una reunión con el equipo de ventas.

Pautas importantes:
- Habla en español, tono cálido y profesional.
- Respuestas cortas y directas (máximo 3 oraciones).
- Si el prospecto pide hablar con una persona, indícalo claramente.
- No inventes información sobre productos; di que la derivarás al equipo.
- Al despedirte, resume brevemente los próximos pasos.`;

const END_PATTERNS = [
  /hasta\s*(luego|pronto|mañana)/i,
  /adiós|adios|chao|bye/i,
  /no\s*(me\s*interesa|gracias|necesito)/i,
  /no\s*tengo\s*(tiempo|interés|interes)/i,
  /llame\s*(más\s*tarde|después|otro\s*día)/i,
  /no\s*quiero\s*continuar/i,
];

const TRANSFER_PATTERNS = [
  /hablar?\s*con\s*(una\s*persona|alguien|humano|agente|vendedor)/i,
  /quiero\s*(hablar|comunicarme)\s*(con|a)/i,
  /pásenme|pasenme|transfieranme|transferencia/i,
  /asesor\s*humano/i,
];

const LEAD_SCHEMA = {
  type: 'object',
  properties: {
    name:          { type: 'string', description: 'Nombre completo del prospecto' },
    email:         { type: 'string', description: 'Email de contacto' },
    company:       { type: 'string', description: 'Empresa u organización' },
    phone:         { type: 'string', description: 'Número de teléfono si fue mencionado' },
    budget:        { type: 'string', description: 'Presupuesto aproximado mencionado' },
    timeline:      { type: 'string', description: 'Plazo para tomar decisión' },
    interestLevel: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Nivel de interés detectado' },
    mainNeed:      { type: 'string', description: 'Necesidad o problema principal expresado' },
    notes:         { type: 'string', description: 'Observaciones adicionales relevantes' },
  },
};

function isEndIntent(text) {
  return END_PATTERNS.some(p => p.test(text));
}

function shouldTransferToHuman(text) {
  return TRANSFER_PATTERNS.some(p => p.test(text));
}

async function extractLeadData(messages) {
  try {
    return await extractStructuredData(messages, LEAD_SCHEMA);
  } catch {
    return {};
  }
}

module.exports = { SYSTEM_PROMPT, isEndIntent, shouldTransferToHuman, extractLeadData };
