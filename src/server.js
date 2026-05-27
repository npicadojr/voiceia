require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

const twilioRoutes = require('./routes/twilio');
const callsRoutes  = require('./routes/calls');
const adminRoutes  = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

const AUDIO_DIR = '/tmp/audio';
if (!process.env.VERCEL && !fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static: TTS audio (local) and dashboard UI
if (!process.env.VERCEL) {
  app.use('/audio', express.static(AUDIO_DIR));
}
app.use('/dashboard', express.static(path.join(__dirname, '../public')));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.use('/twilio', twilioRoutes);
app.use('/calls',  callsRoutes);
app.use('/admin',  adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    logger.info(`Voice AI server running on port ${PORT}`);
    logger.info(`Dashboard: http://localhost:${PORT}/dashboard`);
    logger.info(`Webhooks base URL: ${process.env.BASE_URL || 'NOT SET'}`);
    if (!process.env.ADMIN_API_KEY) logger.warn('ADMIN_API_KEY not set — admin routes unprotected!');
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = app;
