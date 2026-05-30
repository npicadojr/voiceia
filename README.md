# Voice AI System

Sistema multi-tenant de llamadas telefónicas automatizadas con IA. Orquesta Twilio (voz), OpenAI Whisper (STT), GPT-4o-mini (LLM) y ElevenLabs (TTS) para agentes conversacionales por teléfono.

## Arquitectura

```
Twilio → POST /twilio/voice
  └─ Saludo ElevenLabs (Play) + Record
       └─ Usuario habla → POST /twilio/transcribe
            ├─ OpenAI Whisper (STT)
            ├─ GPT-4o-mini (LLM)
            └─ ElevenLabs TTS → Vercel Blob
                 └─ Play audio + Record (loop)
                      └─ Intención de fin → Hangup + guardar en Supabase
```

**Stack:**
- **Twilio** — telefonía (inbound + outbound, TwiML)
- **OpenAI** — STT (`whisper-1`) + LLM (`gpt-4o-mini`) + extracción estructurada (`gpt-4o`)
- **ElevenLabs** — TTS (`eleven_multilingual_v2`), español nativo
- **Supabase** — PostgreSQL (calls, messages, leads, tenants)
- **Vercel Blob** — almacenamiento de audio TTS en producción
- **Google Calendar / Calendly** — agenda de citas (por tenant)
- **Resend** — emails de confirmación de citas

## Agentes

| Agente | `?agent=` | Descripción |
|--------|-----------|-------------|
| `leadQualifier` | `leadQualifier` | Califica leads, extrae nombre/email/empresa/presupuesto |
| `appointmentBooker` | `appointmentBooker` | Agenda citas vía Google Calendar o Calendly (tool calling) |
| `surveyor` | `surveyor` | Encuestas NPS/CSAT |
| `support` | `support` | Soporte técnico nivel 1 con escalación a humano |

## Estructura

```
src/
  server.js                   # Express app
  supabase.js                 # Cliente Supabase
  routes/
    twilio.js                 # Webhooks TwiML — lógica principal de llamadas
    calls.js                  # API REST de llamadas
    admin.js                  # Gestión multi-tenant (requiere ADMIN_API_KEY)
  services/
    openai.js                 # Whisper STT + GPT-4o-mini + tool calling
    elevenlabs.js             # TTS → Vercel Blob o /tmp/audio
    twilio.js                 # Llamadas salientes
    calendar.js               # Google Calendar (disponibilidad + reserva)
    calendly.js               # Calendly API
    email.js                  # Resend (links de confirmación)
  agents/
    leadQualifier.js
    appointmentBooker.js      # Tool calling para Calendar/Calendly
    surveyor.js
    support.js
  models/
    call.js                   # CRUD calls + messages
    lead.js                   # CRUD leads
    tenant.js                 # CRUD tenants + agent_configs
  middleware/
    auth.js                   # Validación ADMIN_API_KEY
  utils/
    conversationManager.js    # Historial de conversación (Supabase)
    tenantCache.js            # Cache en memoria de configs de tenant (TTL 5 min)
    logger.js                 # Winston logger
    apiKey.js                 # Generador de API keys
api/
  index.js                    # Entry point para Vercel serverless
```

## Requisitos

- Node.js 20+
- Cuenta Twilio con número habilitado para voz
- Proyecto Supabase
- API keys: OpenAI, ElevenLabs
- Cuenta Vercel (deploy + Blob storage)

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

| Variable | Descripción |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Account SID de Twilio |
| `TWILIO_AUTH_TOKEN` | Auth token de Twilio |
| `TWILIO_PHONE_NUMBER` | Número Twilio en formato E.164 |
| `OPENAI_API_KEY` | API key de OpenAI |
| `ELEVENLABS_API_KEY` | API key de ElevenLabs |
| `ELEVENLABS_VOICE_ID` | ID de voz (default: `EXAVITQu4vr4xnSDxMaL` — Sarah) |
| `ELEVENLABS_MODEL` | Modelo TTS (default: `eleven_multilingual_v2`) |
| `SUPABASE_URL` | URL de tu proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (Project Settings → API) |
| `BASE_URL` | URL pública del servidor (Vercel URL o ngrok) |
| `BLOB_READ_WRITE_TOKEN` | Token de Vercel Blob (para audio en producción) |
| `HUMAN_AGENT_NUMBER` | Número al que transferir llamadas cuando el usuario lo pide |
| `ADMIN_API_KEY` | Clave para proteger los endpoints `/admin/*` |
| `RESEND_API_KEY` | API key de Resend (emails de confirmación de citas) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |

> Las credenciales de Google Calendar por tenant (`google_refresh_token`, `google_calendar_id`) se configuran en la tabla `tenants` vía Admin API, no en variables de entorno globales.

### 3. Inicializar base de datos

Ejecuta el script `seed.sql` en el SQL Editor de Supabase:

```
Supabase Dashboard → SQL Editor → pegar seed.sql → Run
```

Tablas creadas: `tenants`, `agent_configs`, `calls`, `messages`, `leads`.

### 4. Crear el primer tenant

```bash
curl -X POST https://TU-URL/admin/tenants \
  -H "x-api-key: TU_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Empresa",
    "slug": "mi-empresa",
    "phoneNumber": "+1XXXXXXXXXX",
    "defaultAgent": "leadQualifier"
  }'
```

### 5. Levantar el servidor

```bash
npm run dev   # desarrollo (hot reload)
npm start     # producción
```

### 6. Exponer con ngrok (desarrollo local)

```bash
ngrok http 3000
```

Copia la URL HTTPS y actualiza `BASE_URL` en tu `.env`.

### 7. Configurar webhook en Twilio

En [Twilio Console](https://console.twilio.com) → Phone Numbers → tu número:

- **A Call Comes In** → `https://TU-URL/twilio/voice` (POST)
- **Call Status Changes** → `https://TU-URL/twilio/status` (POST)

Para llamadas salientes el webhook se pasa automáticamente al crear la llamada.

## Deploy en Vercel

```bash
vercel        # preview
vercel --prod # producción
```

Agrega las variables de entorno en Vercel Dashboard → Settings → Environment Variables.

El proyecto ya incluye `vercel.json` y `api/index.js` listos.

## API Reference

### `POST /calls/outbound` — Llamada saliente

```bash
curl -X POST https://TU-URL/calls/outbound \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_ADMIN_API_KEY" \
  -d '{"to": "+50712345678", "agent": "leadQualifier"}'
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `to` | string | Número destino E.164 (requerido) |
| `agent` | string | `leadQualifier` \| `appointmentBooker` \| `surveyor` \| `support` |

### `GET /calls` — Listar llamadas

```
GET /calls?status=completed&agent=leadQualifier&limit=20&offset=0
```

Filtros: `status`, `agent`, `from` (fecha ISO), `to` (fecha ISO), `limit`, `offset`.

### `GET /calls/:id` — Detalle con transcripción

Devuelve la llamada con todos los mensajes de la conversación.

### `POST /calls/:id/transfer` — Transferir a humano

```bash
curl -X POST https://TU-URL/calls/{id}/transfer \
  -H "Content-Type: application/json" \
  -d '{"transferTo": "+50700000000"}'
```

### `GET /health`

```json
{ "status": "ok", "timestamp": "..." }
```

## Admin API

Todos los endpoints requieren `x-api-key: TU_ADMIN_API_KEY`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/admin/tenants` | Crear tenant |
| `GET` | `/admin/tenants` | Listar tenants |
| `GET` | `/admin/tenants/:id` | Obtener tenant |
| `PUT` | `/admin/tenants/:id` | Actualizar tenant |
| `DELETE` | `/admin/tenants/:id` | Desactivar tenant |
| `PUT` | `/admin/tenants/:id/agents/:type` | Personalizar system prompt y saludo por agente |
| `POST` | `/admin/tenants/:id/regenerate-greeting` | Re-generar y cachear saludo en Vercel Blob |
| `POST` | `/admin/tenants/:id/calls/outbound` | Llamada saliente desde un tenant |
| `GET` | `/admin/tenants/:id/calls` | Llamadas de un tenant |

**Campos actualizables en `PUT /admin/tenants/:id`:**

```json
{
  "system_prompt": "Eres Ana, asistente de ventas de Acme...",
  "greeting_text": "¡Hola! Soy Ana de Acme, ¿tiene un momento?",
  "openai_voice": "nova",
  "elevenlabs_voice_id": "VOICE_ID",
  "calendar_provider": "google | calendly | calendly_free",
  "google_refresh_token": "...",
  "google_calendar_id": "primary",
  "calendly_api_token": "...",
  "calendly_event_type_uri": "...",
  "calendly_link": "https://calendly.com/...",
  "human_agent_number": "+1XXXXXXXXXX",
  "email_from": "citas@tuempresa.com",
  "timezone": "America/Panama",
  "default_agent": "appointmentBooker"
}
```

## Calendarios (agente appointmentBooker)

El agente soporta tres modos según `calendar_provider` del tenant:

| Modo | Descripción |
|------|-------------|
| `google` | Consulta disponibilidad y crea eventos en Google Calendar. Requiere `google_refresh_token`. |
| `calendly` | Consulta slots y genera links de reserva únicos vía Calendly API. Requiere `calendly_api_token` + `calendly_event_type_uri`. |
| `calendly_free` | Solo envía el link fijo de Calendly al correo del cliente. Requiere `calendly_link`. |

### Configurar Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com) → habilitar **Google Calendar API**
2. Crear credenciales OAuth 2.0 (tipo Desktop app)
3. Obtener refresh token con scope `https://www.googleapis.com/auth/calendar`
4. Guardar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en variables de entorno
5. Por tenant: configurar `google_refresh_token` y `google_calendar_id` vía Admin API
