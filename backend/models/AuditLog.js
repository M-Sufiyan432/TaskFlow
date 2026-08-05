const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      // User actions
      'user_created',
      'user_updated',
      'user_deleted',
      'user_login',
      'user_logout',
      'password_changed',
      'role_changed',
      
      // Club actions
      'club_created',
      'club_updated',
      'club_deleted',
      'member_added',
      'member_removed',
      'member_role_changed',
      
      // Task actions
      'task_created',
      'task_updated',
      'task_deleted',
      'task_assigned',
      'task_completed',
      'task_status_changed',
      'proof_submitted',
      'proof_approved',
      'proof_rejected',
      'ai_breakdown_requested',
      
      // Event actions
      'event_created',
      'event_updated',
      'event_deleted',
      'event_cancelled',
      'rsvp_added',
      'attendance_marked',
      
      // Admin actions
      'admin_action',
      'settings_changed',
      'data_exported',
      
      // System actions
      'system_action'
    ]
  },
  entityType: {
    type: String,
    enum: ['User', 'Club', 'Task', 'Event', 'Notification', 'ProofSubmission', 'AiTaskBreakdownJob', 'System'],
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club'
    },
    additionalInfo: mongoose.Schema.Types.Mixed
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  }
}, {
  timestamps: true
});

// Indexes
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ 'metadata.clubId': 1 });
auditLogSchema.index({ severity: 1 });

// Static method to log action
auditLogSchema.statics.logAction = async function(data) {
  try {
    const log = await this.create(data);
    return log;
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
};

// Static method to get logs by user
auditLogSchema.statics.getLogsByUser = async function(userId, limit = 50) {
  return await this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', 'name email');
};

// Static method to get logs by entity
auditLogSchema.statics.getLogsByEntity = async function(entityType, entityId, limit = 50) {
  return await this.find({ entityType, entityId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', 'name email');
};

// Static method to get logs by club
auditLogSchema.statics.getLogsByClub = async function(clubId, limit = 100) {
  return await this.find({ 'metadata.clubId': clubId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', 'name email');
};

// Static method to delete old logs
auditLogSchema.statics.deleteOldLogs = async function(daysOld = 365) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate },
    severity: { $ne: 'critical' }
  });
  
  return result.deletedCount;
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
