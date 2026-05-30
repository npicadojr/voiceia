# Prompt para Claude Code — Voice AI System

Eres un experto en Node.js y sistemas de voz con Twilio. Estás trabajando en un sistema multi-tenant de llamadas telefónicas automatizadas con IA.

## Contexto del proyecto

Lee primero el `README.md` y la estructura completa del proyecto antes de tocar cualquier archivo. El stack es:
- Express.js desplegado en Vercel serverless
- Twilio (inbound + outbound, TwiML, webhooks HTTP)
- OpenAI: Whisper STT (`whisper-1`) + GPT-4o-mini LLM + TTS (`tts-1`)
- ElevenLabs TTS (a reemplazar con OpenAI TTS en esta tarea)
- Supabase PostgreSQL (tablas: calls, messages, leads, tenants, agent_configs)
- Vercel Blob (almacenamiento de audio)
- Multi-tenant: cada tenant tiene su configuración en Supabase, cacheada en memoria con TTL 5 min

---

## Tareas (implementar en este orden, confirmar al terminar cada una)

---

### TAREA 1 — Auth en `POST /calls/outbound`

**Problema:** El endpoint está expuesto públicamente sin autenticación. Cualquiera puede disparar llamadas salientes, generando cargos de Twilio (toll fraud).

**Implementar:**
- En `src/routes/calls.js`, aplicar el middleware existente de `src/middleware/auth.js` al endpoint `POST /calls/outbound`
- El mismo `x-api-key` que usan los endpoints `/admin/*`
- NO tocar el endpoint `/admin/tenants/:id/calls/outbound` (ya tiene auth)
- Actualizar el ejemplo de curl en el README para incluir el header `x-api-key`

**Criterio de éxito:** `POST /calls/outbound` sin header devuelve 401. Con header correcto funciona igual que antes.

---

### TAREA 2 — Validación de firma Twilio en webhooks

**Problema:** Los webhooks `/twilio/voice`, `/twilio/transcribe`, `/twilio/status` no validan `X-Twilio-Signature`. Cualquiera que conozca la URL puede enviar POSTs falsos e inyectar transcripciones o manipular llamadas.

**Implementar:**
- Crear `src/middleware/twilioAuth.js` usando `twilio.validateRequest()` del SDK de Twilio
- Parámetros: `TWILIO_AUTH_TOKEN`, la URL completa del webhook (`BASE_URL` + path), y el body de la request
- Aplicar el middleware a todas las rutas en `src/routes/twilio.js`
- Manejar correctamente el body como `application/x-www-form-urlencoded` (Twilio no envía JSON)
- Variable de entorno `TWILIO_SKIP_VALIDATION=true` para desarrollo local con ngrok (loggear un warning cuando esté activa)
- En caso de firma inválida: responder con TwiML de error genérico (no exponer detalles), loggear con Winston nivel `warn`
- Agregar `TWILIO_SKIP_VALIDATION` a `.env.example`

**Criterio de éxito:** Una request POST a `/twilio/voice` sin firma válida devuelve TwiML de error. Las llamadas reales de Twilio siguen funcionando.

---

### TAREA 3 — Reemplazar ElevenLabs TTS con OpenAI TTS (streaming directo, sin Blob)

**Problema actual:** El flujo es ElevenLabs genera audio → sube a Vercel Blob → espera URL → TwiML Play URL. El upload a Blob agrega 300-800ms de latencia por turno.

**Solución:** Servir el audio directamente desde un endpoint de tu API. Twilio hace GET a esa URL, tu servidor llama a OpenAI TTS en ese momento y hace pipe del stream de vuelta a Twilio. Sin Blob, sin upload.

**Implementar:**

1. En `src/services/openai.js`, agregar:
   - `generateAudioUrl(text, voice = 'nova')` — genera una URL firmada para el endpoint `/audio/:token`
   - El token es un payload JSON `{ text, voice, ts: Date.now() }` codificado en base64url
   - Firmado con HMAC-SHA256 usando `process.env.AUDIO_SECRET`
   - Formato: `BASE_URL/audio/{payload}.{sig16chars}`

2. Crear `src/routes/audio.js` con `GET /audio/:token`:
   - Separar el token en `[payload, sig]` por el último punto
   - Verificar HMAC-SHA256 del payload contra sig (primeros 16 chars del hex)
   - Si inválido: 403
   - Parsear payload: `JSON.parse(Buffer.from(payload, 'base64url').toString())`
   - Si `Date.now() - ts > 60_000`: 410 (expirado)
   - Llamar `openai.audio.speech.create({ model: 'tts-1', voice, input: text, response_format: 'mp3' })`
   - Responder con `Content-Type: audio/mpeg` y `Readable.fromWeb(response.body).pipe(res)`

3. Registrar la ruta en `src/server.js`: `app.use('/audio', require('./routes/audio'))`

4. Modificar `src/routes/twilio.js`:
   - Reemplazar las llamadas a ElevenLabs TTS por `generateAudioUrl(text, tenant.openai_voice || 'nova')`
   - Usar esa URL directamente en `<Play>`

5. Para el saludo (greeting): si el tenant tiene `greeting_blob_url` en su config cacheada, usar esa URL directamente. Si no, usar `generateAudioUrl(greetingText)` (se cachea en la siguiente tarea).

6. NO borrar `src/services/elevenlabs.js` — dejarlo en caso de que algún tenant lo use como fallback futuro.

7. Agregar a `.env.example`:
   ```
   AUDIO_SECRET=   # generá con: openssl rand -hex 32
   ```

**Voces disponibles en tts-1:** alloy, echo, fable, onyx, nova, shimmer. Default: nova (la más natural para español).

**Criterio de éxito:** Una llamada completa funciona sin que se suba ningún archivo a Vercel Blob durante la conversación. El audio del agente se sirve desde `/audio/:token`.

---

### TAREA 4 — Pre-cachear saludo estático por tenant en Vercel Blob

**Problema:** El saludo de cada tenant se sintetiza en cada llamada, gastando créditos TTS y añadiendo latencia al inicio de la llamada.

**Implementar:**

1. Crear `src/services/greetingCache.js`:
   - `generateAndCacheGreeting(tenantId, greetingText, voice)`:
     - Genera audio con OpenAI TTS (`tts-1`, formato mp3)
     - Sube a Vercel Blob con key `greeting-${tenantId}.mp3` (reemplaza si ya existe)
     - Retorna la URL pública del Blob
   - `getGreetingUrl(tenantId)`:
     - Intenta obtener el blob `greeting-${tenantId}.mp3` de Vercel Blob
     - Retorna la URL si existe, `null` si no

2. Modificar `src/routes/twilio.js` — al inicio de cada llamada:
   ```
   let greetingUrl = await getGreetingUrl(tenant.id)
   if (!greetingUrl) {
     greetingUrl = await generateAndCacheGreeting(tenant.id, tenant.greeting_text, tenant.openai_voice || 'nova')
   }
   // usar greetingUrl en <Play>
   ```

3. En `src/routes/admin.js`, endpoint `PUT /admin/tenants/:id`:
   - Cuando el body incluye `greeting_text` o `elevenlabs_voice_id` (o `openai_voice`):
     - Después de actualizar en Supabase, llamar a `generateAndCacheGreeting()` con el nuevo texto/voz
     - Loggear el resultado con Winston

4. Agregar endpoint `POST /admin/tenants/:id/regenerate-greeting` en `src/routes/admin.js`:
   - Requiere `x-api-key`
   - Llama a `generateAndCacheGreeting()` con los datos actuales del tenant
   - Responde con `{ url: greetingBlobUrl }`

**Criterio de éxito:** La segunda llamada a un tenant no genera audio TTS para el saludo — usa directamente el Blob URL. El endpoint de regeneración funciona y actualiza el archivo en Blob.

---

## Constraints

- No modificar el esquema de Supabase (no agregar columnas) sin avisarme primero
- No romper ningún endpoint existente ni el flujo de conversación actual
- Mantener el estilo de logging con Winston existente en el proyecto
- Seguir los patrones de manejo de errores que ya usa el código
- Si encontrás algo roto o mejorable fuera de estas tareas, mencionámelo pero no lo cambies sin consultarme
- Al terminar cada tarea: mostrar un resumen de archivos modificados/creados y los cambios clave

## Orden de ejecución

1 → 2 → 3 → 4. Confirmá conmigo al terminar cada tarea antes de continuar.
