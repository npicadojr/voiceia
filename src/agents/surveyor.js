const { extractStructuredData } = require('../services/openai');

const SYSTEM_PROMPT = `Eres un encuestador amable y empático. Realizas encuestas de satisfacción (NPS/CSAT) de forma conversacional.

Tu misión:
1. Saluda y explica brevemente el propósito de la encuesta (máximo 30 segundos).
2. Haz máximo 5 preguntas, una a la vez:
   - Pregunta NPS: "¿Del 0 al 10, qué tan probable es que nos recomiende?"
   - Satisfacción general: "¿Cómo calificaría su experiencia en general?"
   - Punto más valioso: "¿Qué fue lo que más le gustó?"
   - Área de mejora: "¿Qué podríamos mejorar?"
   - Comentario final: "¿Hay algo más que quiera compartir?"
3. Agradece al finalizar y menciona que los comentarios serán considerados.

Pautas:
- Habla en español, tono cálido y agradecido.
- Respuestas muy cortas, máximo 2 oraciones.
- No presiones si el usuario no quiere responder alguna pregunta.
- Registra la puntuación numérica cuando la mencionen.`;

const END_PATTERNS = [
  /hasta\s*(luego|pronto)/i,
  /adiós|adios|chao|bye/i,
  /ya\s*terminé|ya\s*termine/i,
  /es\s*todo/i,
  /gracias.*bye/i,
];

const TRANSFER_PATTERNS = [
  /hablar?\s*con\s*(alguien|una\s*persona|humano)/i,
  /queja\s*formal/i,
  /pásenme|pasenme/i,
];

const SURVEY_SCHEMA = {
  type: 'object',
  properties: {
    npsScore:       { type: 'number', description: 'Puntuación NPS del 0 al 10' },
    csatScore:      { type: 'number', description: 'Puntuación de satisfacción general del 1 al 5' },
    bestAspect:     { type: 'string', description: 'Aspecto más valorado por el cliente' },
    improvementArea:{ type: 'string', description: 'Área de mejora mencionada' },
    additionalComment: { type: 'string', description: 'Comentario adicional del cliente' },
  },
};

function isEndIntent(text) {
  return END_PATTERNS.some(p => p.test(text));
}

function shouldTransferToHuman(text) {
  return TRANSFER_PATTERNS.some(p => p.test(text));
}

async function extractSurveyResults(messages) {
  try {
    return await extractStructuredData(messages, SURVEY_SCHEMA);
  } catch {
    return {};
  }
}

module.exports = { SYSTEM_PROMPT, isEndIntent, shouldTransferToHuman, extractSurveyResults };
