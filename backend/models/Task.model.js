const mongoose = require('mongoose');

const nullableObjectId = {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Task',
  default: null
};

const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  attachments: [{
    filename: String,
    url: String,
    fileType: String,
    fileSize: Number
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const taskHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: ['created', 'updated', 'status_changed', 'assigned', 'commented', 'attachment_added', 'due_date_changed']
  },
  field: String,
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a task title'],
    trim: true,
    maxlength: [200, 'Title cannot be more than 200 characters']
  },
  description: {
    type: String,
    maxlength: [5000, 'Description cannot be more than 5000 characters']
  },
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['todo', 'inprogress', 'review', 'completed'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  dueDate: {
    type: Date,
    validate: {
      validator: function(value) {
        return !value || !(this.isNew || this.isModified('dueDate')) || value > new Date();
      },
      message: 'Due date must be in the future'
    }
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    url: {
      type: String
    },
    storageProvider: {
      type: String,
      enum: ['cloudinary', 's3'],
      default: 'cloudinary'
    },
    storageKey: {
      type: String,
      index: true
    },
    bucket: String,
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    checksum: String,
    scanStatus: {
      type: String,
      enum: ['pending', 'queued', 'scanning', 'safe', 'infected', 'failed', 'blocked'],
      default: 'pending',
      index: true
    },
    scanProvider: String,
    scanJobId: String,
    scanDetails: mongoose.Schema.Types.Mixed,
    scannedAt: Date,
    quarantineReason: String,
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    moderatedAt: Date,
    moderationNote: String,
    fileType: String,
    fileSize: Number,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [commentSchema],
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurrence: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
      default: null
    },
    interval: {
      type: Number,
      default: 1
    },
    endDate: Date,
    parentTask: nullableObjectId,
    rootTask: nullableObjectId,
    occurrenceKey: {
      type: String,
      default: null
    },
    nextRunAt: {
      type: Date,
      default: null
    },
    lastGeneratedAt: {
      type: Date,
      default: null
    }
  },
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  }],
  subtasks: [{
    title: String,
    completed: {
      type: Boolean,
      default: false
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    completedAt: Date
  }],
  completedAt: Date,
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  history: [taskHistorySchema],
  estimatedHours: {
    type: Number,
    min: 0
  },
  actualHours: {
    type: Number,
    min: 0
  },
  position: {
    type: Number,
    default: 0
  },
  isArchived: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for performance
taskSchema.index({ club: 1, status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ priority: 1 });
taskSchema.index({ tags: 1 });
taskSchema.index({ isArchived: 1 });
taskSchema.index({ createdAt: -1 });
taskSchema.index({ club: 1, position: 1 });
taskSchema.index({ club: 1, isArchived: 1, status: 1, createdAt: -1, _id: -1 });
taskSchema.index({ club: 1, isArchived: 1, position: 1, _id: 1 });
taskSchema.index({ club: 1, isArchived: 1, dueDate: 1, _id: 1 });
taskSchema.index({ assignedTo: 1, isArchived: 1, dueDate: 1, _id: 1 });
taskSchema.index({ club: 1, isArchived: 1, priority: 1, createdAt: -1, _id: -1 });
taskSchema.index({
  isRecurring: 1,
  isArchived: 1,
  'recurrence.frequency': 1,
  'recurrence.nextRunAt': 1,
  dueDate: 1
});
taskSchema.index(
  { 'recurrence.parentTask': 1, 'recurrence.occurrenceKey': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'recurrence.parentTask': { $type: 'objectId' },
      'recurrence.occurrenceKey': { $type: 'string' }
    }
  }
);

// Virtual for overdue status
taskSchema.virtual('isOverdue').get(function() {
  return this.dueDate && this.dueDate < new Date() && this.status !== 'completed';
});

// Virtual for progress percentage (based on subtasks)
taskSchema.virtual('progress').get(function() {
  const subtasks = Array.isArray(this.subtasks) ? this.subtasks : [];

  if (subtasks.length === 0) {
    return this.status === 'completed' ? 100 : 0;
  }
  const completed = subtasks.filter(st => st.completed).length;
  return Math.round((completed / subtasks.length) * 100);
});

// Add comment to task
taskSchema.methods.addComment = async function(userId, content, mentions = [], attachments = []) {
  this.comments.push({
    user: userId,
    content,
    mentions,
    attachments,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  this.history.push({
    user: userId,
    action: 'commented',
    timestamp: new Date()
  });
  
  await this.save();
  return this.comments[this.comments.length - 1];
};

// Update task status
taskSchema.methods.updateStatus = async function(userId, newStatus) {
  const oldStatus = this.status;
  this.status = newStatus;
  
  if (newStatus === 'completed') {
    this.completedAt = new Date();
    this.completedBy = userId;
  } else if (oldStatus === 'completed') {
    this.completedAt = null;
    this.completedBy = null;
  }
  
  this.history.push({
    user: userId,
    action: 'status_changed',
    field: 'status',
    oldValue: oldStatus,
    newValue: newStatus,
    timestamp: new Date()
  });
  
  await this.save();
};

// Assign user to task
taskSchema.methods.assignUser = async function(userId, assigneeId) {
  const alreadyAssigned = this.assignedTo.some(
    id => id.toString() === assigneeId.toString()
  );

  if (!alreadyAssigned) {
    this.assignedTo.push(assigneeId);
    
    this.history.push({
      user: userId,
      action: 'assigned',
      newValue: assigneeId,
      timestamp: new Date()
    });
    
    await this.save();
  }
};

// Unassign user from task
taskSchema.methods.unassignUser = async function(userId, assigneeId) {
  this.assignedTo = this.assignedTo.filter(
    id => id.toString() !== assigneeId.toString()
  );
  
  this.history.push({
    user: userId,
    action: 'updated',
    field: 'assignedTo',
    oldValue: assigneeId,
    timestamp: new Date()
  });
  
  await this.save();
};

// Add attachment
taskSchema.methods.addAttachment = async function(userId, attachment) {
  this.attachments.push({
    ...attachment,
    uploadedBy: userId,
    uploadedAt: new Date()
  });
  
  this.history.push({
    user: userId,
    action: 'attachment_added',
    newValue: attachment.filename,
    timestamp: new Date()
  });
  
  await this.save();
};

// Toggle subtask completion
taskSchema.methods.toggleSubtask = async function(userId, subtaskId) {
  const subtask = this.subtasks.id(subtaskId);
  if (subtask) {
    subtask.completed = !subtask.completed;
    if (subtask.completed) {
      subtask.completedBy = userId;
      subtask.completedAt = new Date();
    } else {
      subtask.completedBy = null;
      subtask.completedAt = null;
    }

    this.history.push({
      user: userId,
      action: 'updated',
      field: `subtasks.${subtaskId}.completed`,
      oldValue: !subtask.completed,
      newValue: subtask.completed,
      timestamp: new Date()
    });

    await this.save();
  }
};

// Pre-save middleware to track changes
taskSchema.pre('save', function(next) {
  if (this.isNew) {
    this.history.push({
      user: this.createdBy,
      action: 'created',
      timestamp: new Date()
    });
  }
  next();
});

// Ensure JSON includes virtuals
taskSchema.set('toJSON', { virtuals: true });
taskSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Task', taskSchema);
