const { Worker } = require('bullmq');
const { getRedisConnection } = require('../config/redis');
const { logger } = require('../config/logger');
const QUEUE_NAMES = require('./queueNames');
const { enqueueDeadLetter } = require('./failureHandler');
const processEmailJob = require('./processors/email.processor');
const processNotificationJob = require('./processors/notification.processor');
const processAuditJob = require('./processors/audit.processor');
const processDeadLetterJob = require('./processors/deadLetter.processor');
const processScheduledJob = require('./processors/scheduled.processor');
const processTaskJob = require('./processors/task.processor');
const processAttachmentJob = require('./processors/attachmentScan.processor');
const processAiJob = require('./processors/ai.processor');
const { captureException } = require('../config/sentry');
const { runWithLogContext } = require('../config/logger');
const { CORRELATION_FIELD, runJobWithTrace } = require('./tracing');

const workers = [];
const lastWorkerErrorLogAt = new Map();

const shouldLogWorkerError = (queueName, error) => {
  const key = `${queueName}:${error.code || error.message}`;
  const now = Date.now();
  const lastLoggedAt = lastWorkerErrorLogAt.get(key) || 0;
  const interval = Number(process.env.WORKER_ERROR_LOG_THROTTLE_MS || 30000);

  if (now - lastLoggedAt < interval) return false;

  lastWorkerErrorLogAt.set(key, now);
  return true;
};

const createWorker = (queueName, processor, concurrency) => {
  const wrappedProcessor = (job) => {
    const correlation = job.data?.[CORRELATION_FIELD] || {};
    return runWithLogContext({
      requestId: correlation.requestId,
      correlationId: correlation.correlationId || correlation.requestId,
      userId: correlation.userId,
      clubId: correlation.clubId,
      queueName,
      jobId: String(job.id),
      jobName: job.name
    }, () => runJobWithTrace(queueName, job, processor));
  };

  const worker = new Worker(queueName, wrappedProcessor, {
    connection: getRedisConnection({ connectionName: `worker:${queueName}` }),
    concurrency
  });

  worker.on('completed', (job) => {
    logger.info('worker.job.completed', {
      queueName,
      jobName: job.name,
      jobId: String(job.id),
      attemptsMade: job.attemptsMade
    });
  });

  worker.on('failed', async (job, error) => {
    if (!job) {
      logger.error('worker.failure', { queueName, error: error.message, stack: error.stack });
      captureException(error, { tags: { queueName } });
      return;
    }

    const correlation = job.data?.[CORRELATION_FIELD] || {};

    logger.error('worker.job.failed', {
      queueName,
      jobName: job.name,
      jobId: String(job.id),
      attemptsMade: job.attemptsMade,
      error: error.message,
      stack: error.stack
    });
    captureException(error, {
      userId: correlation.userId,
      tags: {
        queueName,
        jobName: job.name,
        jobId: String(job.id),
        requestId: correlation.requestId,
        clubId: correlation.clubId
      },
      extra: {
        data: job.data,
        attemptsMade: job.attemptsMade
      }
    });
    try {
      await enqueueDeadLetter(job, error);
    } catch (deadLetterError) {
      logger.error('worker.dead_letter.enqueue_failed', {
        queueName,
        jobName: job.name,
        jobId: String(job.id),
        error: deadLetterError.message
      });
    }
  });

  worker.on('error', (error) => {
    if (shouldLogWorkerError(queueName, error)) {
      logger.error('worker.error', { queueName, error: error.message, stack: error.stack });
      captureException(error, { tags: { queueName } });
    }
  });

  workers.push(worker);
  return worker;
};

const startWorkers = () => {
  createWorker(QUEUE_NAMES.EMAIL, processEmailJob, Number(process.env.EMAIL_WORKER_CONCURRENCY || 5));
  createWorker(QUEUE_NAMES.NOTIFICATIONS, processNotificationJob, Number(process.env.NOTIFICATION_WORKER_CONCURRENCY || 10));
  createWorker(QUEUE_NAMES.AUDIT, processAuditJob, Number(process.env.AUDIT_WORKER_CONCURRENCY || 20));
  createWorker(QUEUE_NAMES.TASKS, processTaskJob, Number(process.env.TASK_WORKER_CONCURRENCY || 3));
  createWorker(QUEUE_NAMES.ATTACHMENTS, processAttachmentJob, Number(process.env.ATTACHMENT_SCAN_WORKER_CONCURRENCY || 2));
  createWorker(QUEUE_NAMES.AI, processAiJob, Number(process.env.AI_WORKER_CONCURRENCY || 2));
  createWorker(QUEUE_NAMES.MAINTENANCE, processScheduledJob, Number(process.env.MAINTENANCE_WORKER_CONCURRENCY || 2));
  createWorker(QUEUE_NAMES.DEAD_LETTER, processDeadLetterJob, Number(process.env.DEAD_LETTER_WORKER_CONCURRENCY || 2));

  logger.info('workers.started', { workerCount: workers.length });
  return workers;
};

const closeWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers.length = 0;
};

module.exports = {
  closeWorkers,
  startWorkers
};
