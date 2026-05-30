const twilio = require('twilio');
const logger = require('../utils/logger');

function twilioAuth(req, res, next) {
  if (process.env.TWILIO_SKIP_VALIDATION === 'true') {
    logger.warn('TWILIO_SKIP_VALIDATION is active — skipping signature check');
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'] || '';
  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
  const url = `${baseUrl}${req.originalUrl}`;

  if (!twilio.validateRequest(authToken, signature, url, req.body)) {
    logger.warn('Invalid Twilio signature', { url, ip: req.ip });
    res.type('text/xml');
    return res.status(403).send(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response><Say>An error occurred. Please try again later.</Say><Hangup/></Response>'
    );
  }

  next();
}

module.exports = { twilioAuth };
