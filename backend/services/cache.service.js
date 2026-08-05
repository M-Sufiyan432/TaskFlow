const { getRedisConnection } = require('../config/redis');
const { logger } = require('../config/logger');

let client;
const enabled = () => process.env.CACHE_ENABLED !== 'false';
const getClient = () => {
  if (!client) client = getRedisConnection({ connectionName: 'cache', lazyConnect: true, enableReadyCheck: false });
  return client;
};
const cacheKey = (...parts) => ['clubflow', 'cache', 'v1', ...parts].join(':');
const readJson = async (key) => {
  if (!enabled()) return null;
  try { const value = await getClient().get(key); return value ? JSON.parse(value) : null; } catch (error) { logger.warn('cache.read_failed', { key, error: error.message }); return null; }
};
const writeJson = async (key, value, ttlSeconds) => {
  if (!enabled()) return;
  try { await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch (error) { logger.warn('cache.write_failed', { key, error: error.message }); }
};
const deleteKeys = async (keys) => {
  if (!enabled() || !keys.length) return;
  try { await getClient().del(...keys); } catch (error) { logger.warn('cache.invalidate_failed', { error: error.message }); }
};
const keys = {
  dashboard: (userId) => cacheKey('dashboard', userId),
  overview: (clubId) => cacheKey('club', clubId, 'overview'),
  taskCounts: (clubId) => cacheKey('club', clubId, 'task-counts'),
  taskAnalytics: (clubId) => cacheKey('club', clubId, 'task-analytics'),
  club: (clubId) => cacheKey('club', clubId, 'overview-document')
};
const invalidateClub = (clubId) => deleteKeys([keys.overview(clubId), keys.taskCounts(clubId), keys.taskAnalytics(clubId), keys.club(clubId)]);
const invalidateDashboard = (userIds = []) => deleteKeys([...new Set(userIds.filter(Boolean).map((id) => keys.dashboard(id)))]);

module.exports = { cacheKey, readJson, writeJson, deleteKeys, keys, invalidateClub, invalidateDashboard };
