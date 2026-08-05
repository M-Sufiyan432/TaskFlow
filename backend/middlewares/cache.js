const { readJson, writeJson } = require('../services/cache.service');

const cacheResponse = ({ key, ttlSeconds, shouldCache = (body) => body?.success === true }) => async (req, res, next) => {
  const resolvedKey = typeof key === 'function' ? key(req) : key;
  const cached = await readJson(resolvedKey);
  if (cached) return res.set('X-Cache', 'HIT').status(200).json(cached);
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 300 && shouldCache(body)) writeJson(resolvedKey, body, ttlSeconds);
    return originalJson(body);
  };
  res.set('X-Cache', 'MISS');
  return next();
};
module.exports = { cacheResponse };
