const JOB_NAMES = {
  EMAIL_SEND: 'email.send',
  NOTIFICATION_CREATE: 'notification.create',
  NOTIFICATION_DIGEST: 'notification.digest.daily',
  AUDIT_LOG_CREATE: 'audit.log.create',
  TASK_OVERDUE_SCAN: 'task.scan.overdue',
  TASK_DUE_SOON_SCAN: 'task.scan.due-soon',
  TASK_REMINDER_SEND: 'task.reminder.send',
  TASK_RECURRING_SCAN: 'task.recurring.scan',
  TASK_RECURRING_GENERATE: 'task.recurring.generate',
  ATTACHMENT_SCAN: 'attachment.scan',
  ATTACHMENT_SCAN_CLEANUP: 'attachment.scan.cleanup',
  AI_TASK_BREAKDOWN: 'ai.task.breakdown',
  AI_TRANSCRIPT_EXTRACTION: 'ai.transcript.extraction',
  EVENT_REMINDER_SCAN: 'event.scan.reminders',
  NOTIFICATION_CLEANUP: 'notification.cleanup.old',
  AUDIT_LOG_CLEANUP: 'audit.cleanup.old',
  DEAD_LETTER_CAPTURE: 'dead-letter.capture'
};

module.exports = JOB_NAMES;
