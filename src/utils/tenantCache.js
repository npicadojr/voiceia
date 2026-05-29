const TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function set(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
}

function invalidate(key) {
  cache.delete(key);
}

module.exports = { get, set, invalidate };
