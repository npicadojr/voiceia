const tenantModel = require('../models/tenant');

function adminAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function tenantAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'x-api-key header required' });

  const tenant = await tenantModel.getTenantByApiKey(key);
  if (!tenant || !tenant.active) return res.status(401).json({ error: 'Invalid or inactive API key' });

  req.tenant = tenant;
  next();
}

module.exports = { adminAuth, tenantAuth };
