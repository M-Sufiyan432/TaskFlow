const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  action: { type: String, enum: ['submitted', 'approved', 'rejected'], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  comment: { type: String, maxlength: 2000 },
  attachments: [{
    attachmentId: mongoose.Schema.Types.ObjectId,
    filename: String,
    url: String,
    storageKey: String,
    fileType: String
  }]
}, { timestamps: true, _id: true });

const proofSubmissionSchema = new mongoose.Schema({
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  comment: { type: String, maxlength: 2000 },
  attachments: [{
    attachmentId: mongoose.Schema.Types.ObjectId,
    filename: { type: String, required: true },
    url: String,
    storageKey: String,
    fileType: String
  }],
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  rejectionComment: { type: String, maxlength: 2000 },
  history: [reviewSchema]
}, { timestamps: true, optimisticConcurrency: true });

proofSubmissionSchema.index({ task: 1, createdAt: -1 });
proofSubmissionSchema.index({ club: 1, status: 1, createdAt: -1 });
proofSubmissionSchema.index({ task: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('ProofSubmission', proofSubmissionSchema);
