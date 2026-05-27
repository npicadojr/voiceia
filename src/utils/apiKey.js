const crypto = require('crypto');

function generateApiKey() {
  return 'vk_' + crypto.randomBytes(32).toString('hex');
}

module.exports = { generateApiKey };
