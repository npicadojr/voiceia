# Voice AI System

Sistema de llamadas telefónicas automatizadas con IA. Orquesta Twilio (voz), OpenAI Whisper (STT), GPT-4o (conversación) y ElevenLabs (TTS) para agentes conversacionales por teléfono.

## Flujo de una llamada

```
Twilio → POST /twilio/voice
  └─ Saludo ElevenLabs (Play) + Record
       └─ Usuario habla → POST /twilio/transcribe
            └─ Whisper STT → GPT-4o → ElevenLabs TTS
                 └─ Play audio + Record (loop)
                      └─ Intención de fin → Hangup + guardar datos
```

## Agentes disponibles

| Agente | Query param | Descripción |
|--------|-------------|-------------|
| `leadQualifier` | `?agent=leadQualifier` | Califica leads, extrae datos de contacto |
| `appointmentBooker` | `?agent=appointmentBooker` | Agenda citas en Google Calendar |
| `surveyor` | `?agent=surveyor` | Encuestas NPS/CSAT |
| `support` | `?agent=support` | Soporte técnico nivel 1 |

## Requisitos

- Node.js 20+
- PostgreSQL 14+
- Cuenta Twilio con número habilitado para voz
- API keys: OpenAI, ElevenLabs
- [ngrok](https://ngrok.com/) para desarrollo local

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

| Variable | Descripción |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Account SID de Twilio |
| `TWILIO_AUTH_TOKEN` | Auth token de Twilio |
| `TWILIO_PHONE_NUMBER` | Número Twilio en formato E.164 |
| `OPENAI_API_KEY` | API key de OpenAI (Whisper + GPT-4o) |
| `ELEVENLABS_API_KEY` | API key de ElevenLabs |
| `ELEVENLABS_VOICE_ID` | ID de voz ElevenLabs (default: Rachel) |
| `DATABASE_URL` | PostgreSQL connection string |
| `BASE_URL` | URL pública del servidor (ngrok o dominio) |
| `HUMAN_AGENT_NUMBER` | Número al que transferir si el usuario lo pide |
| `GOOGLE_CLIENT_ID` | (Opcional) Google OAuth para Calendar |
| `GOOGLE_CLIENT_SECRET` | (Opcional) Google OAuth |
| `GOOGLE_REFRESH_TOKEN` | (Opcional) Refresh token OAuth |
| `GOOGLE_CALENDAR_ID` | (Opcional) ID de calendario (default: primary) |

### 3. Inicializar base de datos

```bash
psql $DATABASE_URL -f seed.sql
# O si tienes psql configurado localmente:
psql -d voice_ai -f seed.sql
```

### 4. Levantar el servidor

```bash
# Desarrollo (con hot reload)
npm run dev

# Producción
npm start
```

### 5. Exponer con ngrok (desarrollo local)

```bash
ngrok http 3000
```

Copia la URL HTTPS de ngrok y actualiza `BASE_URL` en tu `.env`.

### 6. Configurar webhook en Twilio

En tu [Twilio Console](https://console.twilio.com):

1. Ve a **Phone Numbers** → tu número
2. En **Voice & Fax** → **A Call Comes In**:
   - Webhook: `https://TU-NGROK.ngrok.io/twilio/voice`
   - Método: `HTTP POST`
3. En **Call Status Changes**:
   - Webhook: `https://TU-NGROK.ngrok.io/twilio/status`

## API REST

### Iniciar llamada saliente

```bash
curl -X POST http://localhost:3000/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+5491112345678", "agent": "leadQualifier"}'
```

**Body:**
```json
{
  "to": "+5491112345678",        // E.164 requerido
  "agent": "leadQualifier",     // Opcional, default: leadQualifier
  "metadata": {}                 // Opcional, datos extra para el agente
}
```

### Listar llamadas

```bash
curl "http://localhost:3000/calls?status=completed&agent=leadQualifier&limit=10"
```

**Query params:** `status`, `agent`, `from` (fecha), `to` (fecha), `limit`, `offset`

### Detalle de llamada con transcripción

```bash
curl http://localhost:3000/calls/{id}
```

### Transferir llamada activa a humano

```bash
curl -X POST http://localhost:3000/calls/{id}/transfer \
  -H "Content-Type: application/json" \
  -d '{"transferTo": "+5491100000000"}'
```

### Health check

```bash
curl http://localhost:3000/health
```

## Estructura del proyecto

```
src/
  server.js                     # Express app principal
  db.js                         # Pool de PostgreSQL
  routes/
    twilio.js                   # Webhooks Twilio (TwiML)
    calls.js                    # API REST gestión de llamadas
  services/
    openai.js                   # Whisper STT + GPT-4o
    elevenlabs.js               # TTS streaming
    twilio.js                   # Llamadas salientes
    calendar.js                 # Google Calendar
  agents/
    leadQualifier.js
    appointmentBooker.js
    surveyor.js
    support.js
  models/
    call.js                     # Queries PostgreSQL — calls y messages
    lead.js                     # Queries PostgreSQL — leads
  utils/
    conversationManager.js      # Estado de conversación en memoria
    logger.js                   # Winston logger
```

## Google Calendar (opcional)

Para el agente `appointmentBooker`, configura OAuth:

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un proyecto y habilita la **Google Calendar API**
3. Crea credenciales OAuth 2.0 (tipo "Desktop app")
4. Obtén un refresh token con scope `https://www.googleapis.com/auth/calendar`
5. Agrega `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` a `.env`

## ElevenLabs — Voces disponibles

Algunas IDs de voces populares en español:
- `21m00Tcm4TlvDq8ikWAM` — Rachel (inglés, natural)
- Busca voces en español en el [Voice Lab](https://elevenlabs.io/voice-lab)

El sistema usa `eleven_multilingual_v2` por defecto, que soporta español nativo.

## Notas de producción

- Los archivos de audio TTS se guardan en `/tmp/audio/` y son servidos estáticamente. En producción considera usar Vercel Blob o S3 para persistencia.
- El estado de conversación se mantiene en memoria (`conversationManager`). Para múltiples instancias, migra a Redis.
- Twilio requiere que los webhooks sean HTTPS públicos. Usa ngrok en dev o un reverse proxy en prod.
# voiceia
