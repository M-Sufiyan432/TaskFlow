const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true,
    index: true
  },
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'task.created',
      'task.assigned',
      'task.status_changed',
      'task.comment_added',
      'task.attachment_uploaded',
      'proof.submitted',
      'proof.approved',
      'proof.rejected',
      'ai.breakdown_requested',
      'ai.breakdown_ready'
    ],
    index: true
  },
  summary: {
    type: String,
    required: true,
    maxlength: 500
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  requestId: String
}, {
  timestamps: true
});

activitySchema.index({ task: 1, createdAt: -1, _id: -1 });
activitySchema.index({ club: 1, createdAt: -1, _id: -1 });
activitySchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
