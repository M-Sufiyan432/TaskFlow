const { initializeQueues, closeQueues } = require('./queueManager');
const { closeRedisConnection } = require('../config/redis');
const { enqueueEmail } = require('./producers/email.producer');
const { enqueueNotification, enqueueNotifications } = require('./producers/notification.producer');
const { enqueueAuditLog } = require('./producers/audit.producer');
const { enqueueAiTaskBreakdown, enqueueTranscriptExtraction } = require('./producers/ai.producer');
const {
  enqueueAttachmentScan,
  enqueueAttachmentScanCleanup
} = require('./producers/attachment.producer');
const {
  enqueueRecurringTaskGeneration,
  enqueueRecurringTaskScan,
  enqueueTaskReminder,
  scheduleTaskReminders,
  enqueueTaskDueSoonScan,
  enqueueTaskOverdueScan
} = require('./producers/task.producer');

const isQueueEnabled = () => process.env.BACKGROUND_JOBS_ENABLED === 'true';

module.exports = {
  closeQueues,
  closeRedisConnection,
  enqueueAuditLog,
  enqueueAiTaskBreakdown,
  enqueueTranscriptExtraction,
  enqueueAttachmentScan,
  enqueueAttachmentScanCleanup,
  enqueueEmail,
  enqueueNotification,
  enqueueNotifications,
  enqueueRecurringTaskGeneration,
  enqueueRecurringTaskScan,
  enqueueTaskReminder,
  scheduleTaskReminders,
  enqueueTaskDueSoonScan,
  enqueueTaskOverdueScan,
  initializeQueues,
  isQueueEnabled
};
