const retryProfiles = {
  email: {
    attempts: Number(process.env.EMAIL_JOB_ATTEMPTS || 5),
    backoff: { type: 'exponential', delay: 30000 }
  },
  notification: {
    attempts: Number(process.env.NOTIFICATION_JOB_ATTEMPTS || 4),
    backoff: { type: 'exponential', delay: 10000 }
  },
  audit: {
    attempts: Number(process.env.AUDIT_JOB_ATTEMPTS || 8),
    backoff: { type: 'exponential', delay: 5000 }
  },
  scheduled: {
    attempts: Number(process.env.SCHEDULED_JOB_ATTEMPTS || 3),
    backoff: { type: 'exponential', delay: 60000 }
  },
  scan: {
    attempts: Number(process.env.ATTACHMENT_SCAN_JOB_ATTEMPTS || 3),
    backoff: { type: 'exponential', delay: 120000 }
  },
  ai: {
    attempts: Number(process.env.AI_JOB_ATTEMPTS || 3),
    backoff: { type: 'exponential', delay: 30000 }
  },
  deadLetter: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 }
  }
};

const baseJobOptions = {
  removeOnComplete: {
    age: Number(process.env.JOB_COMPLETE_RETENTION_SECONDS || 86400),
    count: Number(process.env.JOB_COMPLETE_RETENTION_COUNT || 1000)
  },
  removeOnFail: false
};

const getJobOptions = (profileName, overrides = {}) => ({
  ...baseJobOptions,
  ...(retryProfiles[profileName] || retryProfiles.scheduled),
  ...overrides
});

module.exports = {
  getJobOptions,
  retryProfiles,
  baseJobOptions
};
