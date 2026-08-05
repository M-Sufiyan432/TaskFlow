const mongoose = require('mongoose');

const aiTaskBreakdownJobSchema = new mongoose.Schema({
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  prompt: { type: String, required: true, trim: true, maxlength: 2000 },
  context: {
    dueDate: Date,
    assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued', index: true },
  result: { type: mongoose.Schema.Types.Mixed },
  usage: { inputTokens: Number, outputTokens: Number, model: String },
  error: { code: String, message: String }
}, { timestamps: true });

aiTaskBreakdownJobSchema.index({ club: 1, createdAt: -1 });
aiTaskBreakdownJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('AiTaskBreakdownJob', aiTaskBreakdownJobSchema);
