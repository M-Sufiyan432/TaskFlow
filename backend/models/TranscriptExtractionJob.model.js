const mongoose = require('mongoose');

const extractedTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 2000 },
  dueDate: Date,
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  evidence: { type: String, maxlength: 500 },
  confidence: { type: Number, min: 0, max: 1, required: true },
  approved: { type: Boolean, default: false }
}, { _id: true });

const transcriptExtractionJobSchema = new mongoose.Schema({
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transcript: { type: String, required: true, maxlength: 50000, select: false },
  context: { meetingDate: Date, assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] },
  status: { type: String, enum: ['queued', 'processing', 'ready_for_approval', 'approved', 'failed'], default: 'queued', index: true },
  tasks: [extractedTaskSchema],
  usage: { inputTokens: Number, outputTokens: Number, model: String },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  error: { code: String, message: String }
}, { timestamps: true, optimisticConcurrency: true });

transcriptExtractionJobSchema.index({ club: 1, createdAt: -1 });
transcriptExtractionJobSchema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('TranscriptExtractionJob', transcriptExtractionJobSchema);
