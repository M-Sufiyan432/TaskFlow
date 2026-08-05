const QUEUE_NAMES = require('../queueNames');
const JOB_NAMES = require('../jobNames');
const { addJob } = require('../queueManager');
const { getJobOptions } = require('../retryStrategy');
const enqueueAiTaskBreakdown = (payload, options = {}) => addJob(QUEUE_NAMES.AI, JOB_NAMES.AI_TASK_BREAKDOWN, payload, getJobOptions('ai', { jobId: options.jobId, priority: options.priority || 2 }));
const enqueueTranscriptExtraction = (payload, options = {}) => addJob(QUEUE_NAMES.AI, JOB_NAMES.AI_TRANSCRIPT_EXTRACTION, payload, getJobOptions('ai', { jobId: options.jobId, priority: options.priority || 2 }));
module.exports = { enqueueAiTaskBreakdown, enqueueTranscriptExtraction };
