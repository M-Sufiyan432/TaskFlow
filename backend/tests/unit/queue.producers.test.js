jest.mock('../../jobs/queueManager', () => ({ addJob: jest.fn().mockResolvedValue({ id: 'job-1' }) }));
jest.mock('../../jobs/retryStrategy', () => ({ getJobOptions: jest.fn((_profile, options) => options) }));

const { addJob } = require('../../jobs/queueManager');
const QUEUE_NAMES = require('../../jobs/queueNames');
const JOB_NAMES = require('../../jobs/jobNames');
const { enqueueNotification } = require('../../jobs/producers/notification.producer');
const { enqueueTranscriptExtraction } = require('../../jobs/producers/ai.producer');

describe('queue producers', () => {
  test('enqueues notification jobs on the notification queue', async () => {
    await enqueueNotification({ recipient: 'user-1' }, { jobId: 'notification-1' });
    expect(addJob).toHaveBeenCalledWith(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.NOTIFICATION_CREATE, { recipient: 'user-1' }, expect.objectContaining({ jobId: 'notification-1' }));
  });

  test('enqueues transcript jobs on the AI queue', async () => {
    await enqueueTranscriptExtraction({ extractionJobId: 'job-1' });
    expect(addJob).toHaveBeenCalledWith(QUEUE_NAMES.AI, JOB_NAMES.AI_TRANSCRIPT_EXTRACTION, { extractionJobId: 'job-1' }, expect.any(Object));
  });
});
