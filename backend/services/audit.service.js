const AuditLog = require('../models/AuditLog.model');
const { enqueueAuditLog, isQueueEnabled } = require('../jobs');
const { logger } = require('../config/logger');

const recordAudit = async (data) => {
  if (!isQueueEnabled()) return AuditLog.logAction(data);
  try {
    await enqueueAuditLog(data, { jobId: `audit:${data.action}:${data.entityId}:${Date.now()}` });
  } catch (error) {
    logger.error('Audit queue failure; persisting synchronously', { error: error.message, action: data.action });
    return AuditLog.logAction(data);
  }
  return null;
};

module.exports = { recordAudit };
