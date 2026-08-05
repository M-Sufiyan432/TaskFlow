const Task = require('../models/Task.model');
const Club = require('../models/Club.model');
const Notification = require('../models/Notification.model');
const AuditLog = require('../models/AuditLog.model');
const cloudinary = require('../config/cloudinary');
const { logger } = require('../config/logger');
const { enqueueAttachmentScan, isQueueEnabled, scheduleTaskReminders } = require('../jobs');
const { createActivity } = require('../services/activity.service');
const { invalidateClub, invalidateDashboard } = require('../services/cache.service');
const { PERMISSIONS, can } = require('../services/permission.service');
const {
  assertTaskAttachmentKey,
  buildTaskAttachmentKey,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  getAllowedMimeTypes,
  getMaxFileSizeBytes,
  getObjectMetadata,
  validateAttachmentFile
} = require('../services/objectStorage.service');

const GLOBAL_ADMIN_ROLES = ['admin', 'superadmin', 'super_admin'];
const TASK_CREATOR_ROLES = ['president', 'vicepresident', 'secretary'];
const TASK_ASSIGNER_ROLES = ['president', 'vicepresident'];
const TASK_MANAGER_ROLES = ['president', 'vicepresident', 'secretary'];
const TASK_DELETER_ROLES = ['president'];
const TASK_STATUSES = ['todo', 'inprogress', 'review', 'completed'];

const normalizeTaskStatus = (status) => {
  const statuses = {
    in_progress: 'inprogress',
    inprogress: 'inprogress',
    in_review: 'review',
    review: 'review',
    done: 'completed',
    completed: 'completed',
    todo: 'todo'
  };

  return statuses[status] || status;
};

const normalizeTaskPriority = (priority) => {
  const priorities = {
    urgent: 'critical',
    critical: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low'
  };

  return priorities[priority] || priority;
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getUserClubIds = (user) => {
  if (!Array.isArray(user?.clubs)) return [];

  return user.clubs
    .map((membership) => membership?.club || membership)
    .filter(Boolean);
};

const idsMatch = (left, right) => left?.toString() === right?.toString();

const isGlobalAdmin = (user) => GLOBAL_ADMIN_ROLES.includes(user?.role);

const getClubRole = (club, userId) => {
  const member = club?.members?.find((entry) => idsMatch(entry.user, userId));
  return member?.role || null;
};

const taskHasAssignee = (task, userId) =>
  Array.isArray(task?.assignedTo) && task.assignedTo.some((assigneeId) => idsMatch(assigneeId, userId));

const emitTaskEvent = (req, clubId, eventName, payload) => {
  const io = req.app.get('io');
  if (io) io.to(`club_${clubId}`).emit(eventName, payload);
};

const emitUserNotification = (req, userId, notification) => {
  const io = req.app.get('io');
  if (io && notification) io.to(`user_${userId}`).emit('notificationCreated', notification);
};

const createAndEmitNotification = async (req, data) => {
  const notification = await Notification.createNotification(data);
  emitUserNotification(req, data.recipient, notification);
  return notification;
};

const scheduleTaskRemindersSafely = async (task) => {
  if (!isQueueEnabled()) return;

  try {
    await scheduleTaskReminders(task);
  } catch (error) {
    logger.error(`Task reminder scheduling error: ${error.message}`);
  }
};

const enqueueAttachmentScanSafely = async ({ taskId, attachmentId, storageKey }) => {
  if (!isQueueEnabled()) return;

  try {
    await enqueueAttachmentScan({
      taskId: taskId.toString(),
      attachmentId: attachmentId.toString(),
      storageKey
    });
  } catch (error) {
    logger.error(`Attachment scan enqueue error: ${error.message}`);
  }
};

const parseCursor = (cursor) => {
  if (!cursor) return null;
  const [date, id] = String(cursor).split('_');
  const createdAt = new Date(date);
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
};

const applyCreatedAtCursor = (query, cursor, direction = 'desc') => {
  const parsed = parseCursor(cursor);
  if (!parsed) return;
  const comparator = direction === 'asc' ? '$gt' : '$lt';
  query.$and = [...(query.$and || []), {
    $or: [{ createdAt: { [comparator]: parsed.createdAt } }, { createdAt: parsed.createdAt, _id: { [comparator]: parsed.id } }]
  }];
};

const invalidateTaskCaches = async (task) => {
  await invalidateClub(task.club);
  await invalidateDashboard([task.createdBy, ...(task.assignedTo || [])]);
};

const recordTaskActivity = async (req, task, type, summary, metadata = {}, changes) => {
  try {
    await createActivity({
      req,
      task,
      type,
      summary,
      metadata,
      changes
    });
  } catch (error) {
    logger.error('Task activity creation error', {
      error: error.message,
      taskId: task?._id,
      type
    });
  }
};

const uploadBufferToCloudinary = (file, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });

const normalizeAssigneeIds = (body) => [
  ...new Set(toArray(body.assignedTo || body.assigneeIds || body.userIds).map((id) => id.toString()))
];

const validateAssigneesBelongToClub = (club, userIds = []) => {
  const memberIds = new Set((club?.members || []).map((member) => member.user.toString()));
  return userIds.filter((userId) => !memberIds.has(userId.toString()));
};

const getReadableValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => item?.toString?.() || item);
  return value;
};

const addFieldHistory = (task, userId, field, oldValue, newValue) => {
  if (JSON.stringify(getReadableValue(oldValue)) === JSON.stringify(getReadableValue(newValue))) return;

  task.history.push({
    user: userId,
    action: field === 'dueDate' ? 'due_date_changed' : 'updated',
    field,
    oldValue: getReadableValue(oldValue),
    newValue: getReadableValue(newValue),
    timestamp: new Date()
  });
};

const getPopulatedTask = (taskId) =>
  Task.findById(taskId)
    .populate('club', 'name logo')
    .populate('createdBy', 'name email profilePhoto')
    .populate('assignedTo', 'name email profilePhoto')
    .populate('comments.user', 'name email profilePhoto')
    .populate('comments.mentions', 'name email')
    .populate('history.user', 'name email')
    .populate('dependencies', 'title status')
    .populate('completedBy', 'name email');

const requireTaskPermission = async (req, res, task, action) => {
  const permissionMap = {
    view: PERMISSIONS.TASK_VIEW,
    status: PERMISSIONS.TASK_STATUS_UPDATE,
    comment: PERMISSIONS.COMMENT_CREATE,
    attachmentUpload: PERMISSIONS.ATTACHMENT_UPLOAD,
    attachmentView: PERMISSIONS.ATTACHMENT_VIEW,
    attachmentModerate: PERMISSIONS.ATTACHMENT_MODERATE,
    subtask: PERMISSIONS.TASK_STATUS_UPDATE,
    update: PERMISSIONS.TASK_UPDATE,
    delete: PERMISSIONS.TASK_DELETE,
    assign: PERMISSIONS.TASK_ASSIGN
  };

  const clubId = task.club?._id || task.club;
  const club = await Club.findById(clubId);
  if (!club) {
    res.status(404).json({
      success: false,
      message: 'Club not found'
    });
    return false;
  }

  const decision = await can(req.user, permissionMap[action], { club, task });

  if (!decision.allowed) {
    res.status(403).json({
      success: false,
      message: decision.reason || 'You are not authorized to perform this task action',
      permission: permissionMap[action]
    });
    return false;
  }

  return true;
};

// @desc    Get all tasks with filtering
// @route   GET /api/tasks
// @access  Private
exports.getAllTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      assignedTo,
      club,
      tags,
      search,
      cursor,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { isArchived: false };

    // Filter by user's clubs if not admin
    const hasGlobalAccess = isGlobalAdmin(req.user);

    if (!hasGlobalAccess) {
      const userClubs = getUserClubIds(req.user);

      if (club && !userClubs.some((clubId) => idsMatch(clubId, club))) {
        return res.status(403).json({
          success: false,
          message: 'You must be a member of this club to access its tasks'
        });
      }

      const clubDocs = await Club.find({ _id: { $in: userClubs } }).select('members');
      const managedClubIds = clubDocs
        .filter((clubDoc) => TASK_MANAGER_ROLES.includes(getClubRole(clubDoc, req.user._id)))
        .map((clubDoc) => clubDoc._id);

      if (assignedTo === 'me') {
        query.assignedTo = req.user._id;
        query.club = club || { $in: userClubs };
      } else if (club) {
        const clubDoc = clubDocs.find((item) => idsMatch(item._id, club));
        const canSeeAllClubTasks = clubDoc && TASK_MANAGER_ROLES.includes(getClubRole(clubDoc, req.user._id));
        query.club = club;
        if (!canSeeAllClubTasks) {
          query.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
        }
      } else {
        query.$or = [
          { club: { $in: managedClubIds } },
          { assignedTo: req.user._id },
          { createdBy: req.user._id }
        ];
      }
    }

    if (status) {
      const statuses = toArray(status).map(normalizeTaskStatus);
      query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (priority) {
      const priorities = toArray(priority).map(normalizeTaskPriority);
      query.priority = priorities.length > 1 ? { $in: priorities } : priorities[0];
    }
    if (assignedTo && assignedTo !== 'me') {
      query.assignedTo = assignedTo === 'me' ? req.user._id : assignedTo;
    }
    if (club && hasGlobalAccess) query.club = club;
    if (tags) query.tags = { $in: toArray(tags) };
    if (search) {
      query.$and = [...(query.$and || []), {
        $or: [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
        ]
      }];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const cursorSort = sortBy === 'createdAt';
    const countQuery = { ...query };
    if (query.$and) countQuery.$and = [...query.$and];
    if (cursorSort) applyCreatedAtCursor(query, cursor, sortOrder);
    const taskQuery = Task.find(query)
      .select('title description club createdBy assignedTo status priority dueDate tags completedAt completedBy estimatedHours actualHours createdAt updatedAt position isArchived')
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .sort(cursorSort ? { createdAt: sortOrder === 'desc' ? -1 : 1, _id: sortOrder === 'desc' ? -1 : 1 } : sort)
      .limit(cursorSort ? pageSize + 1 : pageSize)
      .lean();
    if (!cursorSort) taskQuery.skip((Number(page) - 1) * pageSize);
    const [foundTasks, count] = await Promise.all([taskQuery, Task.countDocuments(countQuery)]);
    const hasMore = cursorSort && foundTasks.length > pageSize;
    const tasks = hasMore ? foundTasks.slice(0, pageSize) : foundTasks;
    const last = tasks[tasks.length - 1];

    res.status(200).json({
      success: true,
      data: tasks,
      tasks,
      totalPages: Math.ceil(count / pageSize),
      currentPage: parseInt(page),
      total: count,
      pageInfo: { hasMore, nextCursor: hasMore && last ? `${last.createdAt.toISOString()}_${last._id}` : null }
    });
  } catch (error) {
    logger.error(`Get All Tasks Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching tasks'
    });
  }
};

// @desc    Get tasks by club
// @route   GET /api/tasks/club/:clubId
// @access  Private
exports.getTasksByClub = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      tags,
      search,
      cursor,
      sortBy = 'position',
      sortOrder = 'asc'
    } = req.query;
    const club = await Club.findById(req.params.clubId);

    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const query = {
      club: req.params.clubId,
      isArchived: false
    };

    const clubRole = getClubRole(club, req.user._id);
    const canSeeAllClubTasks = isGlobalAdmin(req.user) || TASK_MANAGER_ROLES.includes(clubRole);

    if (!canSeeAllClubTasks) {
      query.assignedTo = req.user._id;
    }

    if (status) {
      const statuses = toArray(status).map(normalizeTaskStatus);
      query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (priority) {
      const priorities = toArray(priority).map(normalizeTaskPriority);
      query.priority = priorities.length > 1 ? { $in: priorities } : priorities[0];
    }
    if (tags) query.tags = { $in: toArray(tags) };
    if (search) {
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const cursorSort = sortBy === 'createdAt';
    const countQuery = { ...query };
    if (query.$and) countQuery.$and = [...query.$and];
    if (cursorSort) applyCreatedAtCursor(query, cursor, sortOrder);

    const taskQuery = Task.find(query)
      .select('title description club createdBy assignedTo status priority dueDate tags attachments isRecurring recurrence dependencies subtasks completedAt completedBy estimatedHours actualHours createdAt updatedAt position isArchived')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .sort(cursorSort ? { createdAt: sortOrder === 'desc' ? -1 : 1, _id: sortOrder === 'desc' ? -1 : 1 } : sort)
      .limit(cursorSort ? pageSize + 1 : pageSize)
      .lean();
    if (!cursorSort) taskQuery.skip((Number(page) - 1) * pageSize);
    const [foundTasks, count] = await Promise.all([taskQuery, Task.countDocuments(countQuery)]);
    const hasMore = cursorSort && foundTasks.length > pageSize;
    const tasks = hasMore ? foundTasks.slice(0, pageSize) : foundTasks;
    const last = tasks[tasks.length - 1];

    // Group by status for Kanban view
    const grouped = {
      todo: tasks.filter(t => t.status === 'todo'),
      inprogress: tasks.filter(t => t.status === 'inprogress'),
      review: tasks.filter(t => t.status === 'review'),
      completed: tasks.filter(t => t.status === 'completed')
    };

    res.status(200).json({
      success: true,
      data: tasks,
      tasks,
      grouped,
      totalPages: Math.ceil(count / pageSize),
      currentPage: Number(page),
      total: count,
      pageInfo: { hasMore, nextCursor: hasMore && last ? `${last.createdAt.toISOString()}_${last._id}` : null }
    });
  } catch (error) {
    logger.error(`Get Club Tasks Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching club tasks'
    });
  }
};

// @desc    Create new task
// @route   POST /api/tasks
// @access  Private
exports.createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      club,
      priority,
      status,
      dueDate,
      assignedTo,
      assigneeIds,
      tags,
      attachments,
      isRecurring,
      recurrence,
      estimatedHours,
      subtasks,
      dependencies
    } = req.body;

    // Verify user is club member
    const clubDoc = await Club.findById(club);
    if (!clubDoc) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const createDecision = await can(req.user, PERMISSIONS.TASK_CREATE, { club: clubDoc });
    const assignDecision = await can(req.user, PERMISSIONS.TASK_ASSIGN, { club: clubDoc });
    const canCreateTask = createDecision.allowed;
    const canAssignOnCreate = assignDecision.allowed;

    if (!canCreateTask) {
      return res.status(403).json({
        success: false,
        message: 'Only club officers can create tasks'
      });
    }

    const assigneeIdsToSave = normalizeAssigneeIds({ assignedTo, assigneeIds });
    const invalidAssigneeIds = validateAssigneesBelongToClub(clubDoc, assigneeIdsToSave);

    if (invalidAssigneeIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'All assignees must be members of the club'
      });
    }

    if (assigneeIdsToSave.length > 0 && !canAssignOnCreate) {
      return res.status(403).json({
        success: false,
        message: 'Only president and vice president roles can assign tasks'
      });
    }

    const normalizedStatus = normalizeTaskStatus(status || 'todo');
    if (!TASK_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task status'
      });
    }

    const task = await Task.create({
      title,
      description,
      club,
      createdBy: req.user._id,
      priority: normalizeTaskPriority(priority),
      status: normalizedStatus,
      dueDate,
      assignedTo: assigneeIdsToSave,
      tags: tags || [],
      attachments: attachments || [],
      isRecurring: isRecurring || false,
      recurrence,
      estimatedHours,
      subtasks: subtasks || [],
      dependencies: dependencies || []
    });

    // Update club stats
    clubDoc.stats.totalTasks += 1;
    await clubDoc.save();

    // Populate task
    const populatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto');

    // Create notifications for assigned users
    if (assigneeIdsToSave.length > 0) {
      for (const userId of assigneeIdsToSave) {
        await createAndEmitNotification(req, {
          recipient: userId,
          sender: req.user._id,
          type: 'task_assigned',
          title: 'New Task Assigned',
          message: `You have been assigned to "${title}"`,
          data: {
            taskId: task._id,
            clubId: club
          },
          actionUrl: `/clubs/${club}/tasks/${task._id}`
        });
      }
    }

    emitTaskEvent(req, club, 'taskCreated', populatedTask);
    emitTaskEvent(req, club, 'task_created', populatedTask);

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_created',
      entityType: 'Task',
      entityId: task._id,
      description: `Created task: ${title}`,
      metadata: {
        clubId: club,
        additionalInfo: { taskId: task._id, assigneeIds: assigneeIdsToSave }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.created',
      `Created task "${title}"`,
      { assigneeIds: assigneeIdsToSave, priority: task.priority, status: task.status }
    );

    if (assigneeIdsToSave.length > 0) {
      await recordTaskActivity(
        req,
        task,
        'task.assigned',
        `Assigned ${assigneeIdsToSave.length} user${assigneeIdsToSave.length === 1 ? '' : 's'} to "${title}"`,
        { assigneeIds: assigneeIdsToSave },
        { after: { assignedTo: assigneeIdsToSave } }
      );
    }

    await scheduleTaskRemindersSafely(task);
    await invalidateTaskCaches(task);

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: populatedTask
    });
  } catch (error) {
    logger.error(`Create Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error creating task'
    });
  }
};

// @desc    Get task by ID
// @route   GET /api/tasks/:taskId
// @access  Private
exports.getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .populate('comments.user', 'name email profilePhoto')
      .populate('comments.mentions', 'name email')
      .populate('history.user', 'name email')
      .populate('dependencies', 'title status')
      .populate('completedBy', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'view'))) return;

    res.status(200).json({
      success: true,
      data: task
    });
  } catch (error) {
    logger.error(`Get Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching task'
    });
  }
};

// @desc    Update task
// @route   PUT /api/tasks/:taskId
// @access  Private
exports.updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'update'))) return;

    const allowedFields = [
      'title',
      'description',
      'priority',
      'dueDate',
      'tags',
      'attachments',
      'subtasks',
      'dependencies',
      'isRecurring',
      'recurrence',
      'estimatedHours',
      'actualHours'
    ];

    const changes = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        const oldValue = task[field];
        const newValue = field === 'priority' ? normalizeTaskPriority(req.body[field]) : req.body[field];
        changes[field] = {
          before: getReadableValue(oldValue),
          after: getReadableValue(newValue)
        };
        addFieldHistory(task, req.user._id, field, oldValue, newValue);
        task[field] = newValue;
      }
    });

    if (changes.dueDate || changes.recurrence || changes.isRecurring) {
      task.recurrence = {
        ...(task.recurrence?.toObject?.() || task.recurrence || {}),
        nextRunAt: null,
        lastGeneratedAt: null
      };
    }

    await task.save();

    const updatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto');

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_updated', updatedTask);

    // Log audit
    const auditChanges = Object.entries(changes).reduce(
      (acc, [field, value]) => {
        acc.before[field] = value.before;
        acc.after[field] = value.after;
        return acc;
      },
      { before: {}, after: {} }
    );

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_updated',
      entityType: 'Task',
      entityId: task._id,
      description: `Updated task: ${task.title}`,
      changes: auditChanges,
      metadata: {
        clubId: task.club,
        additionalInfo: { taskId: task._id }
      }
    });

    if (changes.dueDate) {
      await scheduleTaskRemindersSafely(task);
    }
    await invalidateTaskCaches(task);

    res.status(200).json({
      success: true,
      message: 'Task updated successfully',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Update Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error updating task'
    });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:taskId
// @access  Private
exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'delete'))) return;

    // Archive instead of delete
    task.isArchived = true;
    task.history.push({
      user: req.user._id,
      action: 'updated',
      field: 'isArchived',
      oldValue: false,
      newValue: true,
      timestamp: new Date()
    });
    await task.save();

    // Update club stats
    const club = await Club.findById(task.club);
    if (club) {
      club.stats.totalTasks = Math.max(0, club.stats.totalTasks - 1);
      if (task.status === 'completed') {
        club.stats.completedTasks = Math.max(0, club.stats.completedTasks - 1);
      }
      await club.save();
    }

    emitTaskEvent(req, task.club, 'taskDeleted', { id: task._id, taskId: task._id });
    emitTaskEvent(req, task.club, 'task_deleted', { id: task._id, taskId: task._id });

    // Log audit
    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_deleted',
      entityType: 'Task',
      entityId: task._id,
      description: `Deleted task: ${task.title}`,
      metadata: {
        clubId: task.club,
        additionalInfo: { taskId: task._id }
      }
    });

    await invalidateTaskCaches(task);

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    logger.error(`Delete Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error deleting task'
    });
  }
};

// @desc    Update task status
// @route   PATCH /api/tasks/:taskId/status
// @access  Private
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const normalizedStatus = normalizeTaskStatus(status);
    if (!TASK_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task status'
      });
    }
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'status'))) return;

    const oldStatus = task.status;
    await task.updateStatus(req.user._id, normalizedStatus);

    // Update club stats
    if (normalizedStatus === 'completed' && oldStatus !== 'completed') {
      const club = await Club.findById(task.club);
      if (club) {
        club.stats.completedTasks += 1;
        await club.save();
      }
    } else if (normalizedStatus !== 'completed' && oldStatus === 'completed') {
      const club = await Club.findById(task.club);
      if (club) {
        club.stats.completedTasks = Math.max(0, club.stats.completedTasks - 1);
        await club.save();
      }
    }

    const updatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .populate('comments.user', 'name email profilePhoto')
      .populate('comments.mentions', 'name email')
      .populate('history.user', 'name email')
      .populate('dependencies', 'title status');

    // Create notifications for assigned users
    if (normalizedStatus === 'completed') {
      for (const userId of task.assignedTo) {
        await createAndEmitNotification(req, {
          recipient: userId,
          sender: req.user._id,
          type: 'task_updated',
          title: 'Task Completed',
          message: `"${task.title}" has been marked as completed`,
          data: {
            taskId: task._id,
            clubId: task.club
          }
        });
      }
    }

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_status_updated', updatedTask);

    await AuditLog.logAction({
      user: req.user._id,
      action: normalizedStatus === 'completed' ? 'task_completed' : 'task_status_changed',
      entityType: 'Task',
      entityId: task._id,
      description: `Changed task status: ${task.title}`,
      changes: {
        before: { status: oldStatus },
        after: { status: normalizedStatus }
      },
      metadata: {
        clubId: task.club,
        additionalInfo: { taskId: task._id }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.status_changed',
      `Changed status from ${oldStatus} to ${normalizedStatus}`,
      {},
      { before: { status: oldStatus }, after: { status: normalizedStatus } }
    );

    if (normalizedStatus !== 'completed') {
      await scheduleTaskRemindersSafely(task);
    }
    await invalidateTaskCaches(task);

    res.status(200).json({
      success: true,
      message: 'Task status updated',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Update Task Status Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error updating task status'
    });
  }
};

// @desc    Assign users to task
// @route   POST /api/tasks/:taskId/assign
// @access  Private
exports.assignTask = async (req, res) => {
  try {
    const userIds = normalizeAssigneeIds(req.body);
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'assign'))) return;

    const club = await Club.findById(task.club);
    const invalidAssigneeIds = validateAssigneesBelongToClub(club, userIds);
    if (invalidAssigneeIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'All assignees must be members of the club'
      });
    }

    for (const userId of userIds) {
      await task.assignUser(req.user._id, userId);

      // Create notification
      await createAndEmitNotification(req, {
        recipient: userId,
        sender: req.user._id,
        type: 'task_assigned',
        title: 'Task Assigned',
        message: `You have been assigned to "${task.title}"`,
        data: {
          taskId: task._id,
          clubId: task.club
        },
        actionUrl: `/clubs/${task.club}/tasks/${task._id}`
      });
    }

    const updatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .populate('comments.user', 'name email profilePhoto')
      .populate('history.user', 'name email')
      .populate('dependencies', 'title status');

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_assigned', updatedTask);

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_assigned',
      entityType: 'Task',
      entityId: task._id,
      description: `Assigned task: ${task.title}`,
      changes: {
        after: { assignedTo: userIds }
      },
      metadata: {
        clubId: task.club,
        additionalInfo: { taskId: task._id }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.assigned',
      `Assigned ${userIds.length} user${userIds.length === 1 ? '' : 's'} to "${task.title}"`,
      { assigneeIds: userIds },
      { after: { assignedTo: task.assignedTo } }
    );

    await scheduleTaskRemindersSafely(task);
    await invalidateTaskCaches(task);

    res.status(200).json({
      success: true,
      message: 'Users assigned successfully',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Assign Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error assigning task'
    });
  }
};

// @desc    Add comment to task
// @route   POST /api/tasks/:taskId/comments
// @access  Private
exports.addComment = async (req, res) => {
  try {
    const { content, mentions, attachments } = req.body;
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'comment'))) return;

    const comment = await task.addComment(
      req.user._id,
      content,
      mentions || [],
      attachments || []
    );

    // Create notifications for mentions
    if (mentions && mentions.length > 0) {
      for (const userId of mentions) {
        await createAndEmitNotification(req, {
          recipient: userId,
          sender: req.user._id,
          type: 'mention',
          title: 'Mentioned in Comment',
          message: `${req.user.name} mentioned you in a comment`,
          data: {
            taskId: task._id,
            clubId: task.club,
            commentId: comment._id
          },
          actionUrl: `/clubs/${task.club}/tasks/${task._id}`
        });
      }
    }

    const updatedTask = await Task.findById(task._id)
      .populate('comments.user', 'name email profilePhoto')
      .populate('comments.mentions', 'name email');

    const commentPayload = {
      id: comment._id,
      taskId: task._id,
      comment: updatedTask.comments[updatedTask.comments.length - 1]
    };
    emitTaskEvent(req, task.club, 'commentAdded', commentPayload);
    emitTaskEvent(req, task.club, 'comment_added', commentPayload);

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_updated',
      entityType: 'Task',
      entityId: task._id,
      description: `Commented on task: ${task.title}`,
      metadata: {
        clubId: task.club,
        additionalInfo: { taskId: task._id, commentId: comment._id }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.comment_added',
      `Added a comment to "${task.title}"`,
      { commentId: comment._id, mentionIds: mentions || [] }
    );

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: comment
    });
  } catch (error) {
    logger.error(`Add Comment Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error adding comment'
    });
  }
};

// @desc    Upload proof/attachment for a task
// @route   POST /api/tasks/:taskId/attachments
// @access  Private
exports.uploadTaskAttachment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'attachmentUpload'))) return;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please attach a file or photo'
      });
    }

    const uploadedFile = await uploadBufferToCloudinary(
      req.file,
      `clubflow/tasks/${task.club}/${task._id}`
    );

    const attachment = {
      filename: req.file.originalname,
      url: uploadedFile.secure_url,
      storageProvider: 'cloudinary',
      visibility: 'public',
      scanStatus: 'failed',
      scanDetails: {
        reason: 'Legacy Cloudinary uploads are public and cannot be scanned by the private object scanner'
      },
      fileType: req.file.mimetype,
      fileSize: req.file.size
    };

    await task.addAttachment(req.user._id, attachment);

    const updatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .populate('comments.user', 'name email profilePhoto')
      .populate('comments.mentions', 'name email')
      .populate('history.user', 'name email')
      .populate('dependencies', 'title status');

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_attachment_added', updatedTask);

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_updated',
      entityType: 'Task',
      entityId: task._id,
      description: `Added task proof attachment: ${task.title}`,
      metadata: {
        clubId: task.club,
        additionalInfo: {
          taskId: task._id,
          attachmentName: req.file.originalname
        }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.attachment_uploaded',
      `Uploaded attachment "${req.file.originalname}"`,
      { filename: req.file.originalname, fileType: req.file.mimetype, fileSize: req.file.size, storageProvider: 'cloudinary' }
    );

    res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Upload Task Attachment Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error uploading task attachment'
    });
  }
};

// @desc    Create a signed URL for direct private task attachment upload
// @route   POST /api/tasks/:taskId/attachments/signed-upload
// @access  Private
exports.createTaskAttachmentUploadUrl = async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body;
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'attachmentUpload'))) return;

    try {
      validateAttachmentFile({ filename, contentType, fileSize });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
        allowedMimeTypes: getAllowedMimeTypes(),
        maxFileSize: getMaxFileSizeBytes()
      });
    }

    const storageKey = buildTaskAttachmentKey({
      clubId: task.club,
      taskId: task._id,
      userId: req.user._id,
      filename
    });

    const uploadUrl = await createSignedUploadUrl({
      key: storageKey,
      contentType,
      fileSize,
      expiresInSeconds: Number(process.env.SIGNED_UPLOAD_URL_TTL_SECONDS || 900)
    });

    res.status(201).json({
      success: true,
      data: {
        uploadUrl,
        method: 'PUT',
        storageProvider: 's3',
        storageKey,
        bucket: process.env.S3_BUCKET_NAME,
        expiresIn: Number(process.env.SIGNED_UPLOAD_URL_TTL_SECONDS || 900),
        headers: {
          'Content-Type': contentType,
          'x-amz-server-side-encryption': process.env.S3_SERVER_SIDE_ENCRYPTION || 'AES256'
        }
      }
    });
  } catch (error) {
    logger.error(`Create Task Attachment Upload URL Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error creating attachment upload URL'
    });
  }
};

// @desc    Save private task attachment metadata after direct upload
// @route   POST /api/tasks/:taskId/attachments/complete
// @access  Private
exports.completeTaskAttachmentUpload = async (req, res) => {
  try {
    const {
      filename,
      contentType,
      fileSize,
      storageKey,
      checksum
    } = req.body;

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'comment'))) return;

    try {
      validateAttachmentFile({ filename, contentType, fileSize });
      assertTaskAttachmentKey({
        key: storageKey,
        clubId: task.club.toString(),
        taskId: task._id.toString()
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    const objectMetadata = await getObjectMetadata(storageKey);
    if (Number(objectMetadata.ContentLength) !== Number(fileSize)) {
      return res.status(400).json({
        success: false,
        message: 'Uploaded file size does not match metadata'
      });
    }

    if (objectMetadata.ContentType && objectMetadata.ContentType !== contentType) {
      return res.status(400).json({
        success: false,
        message: 'Uploaded file type does not match metadata'
      });
    }

    const alreadyAttached = task.attachments.find(
      (attachment) => attachment.storageKey === storageKey
    );

    if (alreadyAttached) {
      return res.status(200).json({
        success: true,
        message: 'Attachment already saved',
        data: alreadyAttached
      });
    }

    const attachment = {
      filename,
      storageProvider: 's3',
      storageKey,
      bucket: process.env.S3_BUCKET_NAME,
      visibility: 'private',
      scanStatus: 'pending',
      checksum,
      fileType: contentType,
      fileSize: Number(fileSize)
    };

    await task.addAttachment(req.user._id, attachment);
    const savedAttachment = task.attachments[task.attachments.length - 1];

    await Task.updateOne(
      { _id: task._id, 'attachments._id': savedAttachment._id },
      {
        $set: {
          'attachments.$.scanStatus': 'queued'
        }
      }
    );

    await enqueueAttachmentScanSafely({
      taskId: task._id,
      attachmentId: savedAttachment._id,
      storageKey
    });

    const updatedTask = await Task.findById(task._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto')
      .populate('assignedTo', 'name email profilePhoto')
      .populate('comments.user', 'name email profilePhoto')
      .populate('comments.mentions', 'name email')
      .populate('history.user', 'name email')
      .populate('dependencies', 'title status');

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_attachment_added', updatedTask);

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_updated',
      entityType: 'Task',
      entityId: task._id,
      description: `Added private task attachment: ${task.title}`,
      metadata: {
        clubId: task.club,
        additionalInfo: {
          taskId: task._id,
          attachmentName: filename,
          storageKey
        }
      }
    });

    await recordTaskActivity(
      req,
      task,
      'task.attachment_uploaded',
      `Uploaded attachment "${filename}"`,
      {
        attachmentId: savedAttachment._id,
        filename,
        fileType: contentType,
        fileSize: Number(fileSize),
        storageProvider: 's3',
        storageKey
      }
    );

    res.status(201).json({
      success: true,
      message: 'Attachment metadata saved successfully',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Complete Task Attachment Upload Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error saving attachment metadata'
    });
  }
};

// @desc    Create a temporary signed URL for private task attachment download
// @route   GET /api/tasks/:taskId/attachments/:attachmentId/download
// @access  Private
exports.getTaskAttachmentDownloadUrl = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'attachmentView'))) return;

    const attachment = task.attachments.id(req.params.attachmentId);
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    if (attachment.storageProvider !== 's3' || attachment.visibility !== 'private') {
      return res.status(200).json({
        success: true,
        data: {
          downloadUrl: attachment.url,
          expiresIn: null,
          storageProvider: attachment.storageProvider || 'cloudinary'
        }
      });
    }

    if (attachment.scanStatus !== 'safe') {
      return res.status(403).json({
        success: false,
        message: attachment.scanStatus === 'infected' || attachment.scanStatus === 'blocked'
          ? 'Attachment has been blocked by security scanning'
          : 'Attachment is not available until security scanning completes',
        data: {
          scanStatus: attachment.scanStatus || 'pending'
        }
      });
    }

    const downloadUrl = await createSignedDownloadUrl({
      key: attachment.storageKey,
      filename: attachment.filename,
      expiresInSeconds: Number(process.env.SIGNED_DOWNLOAD_URL_TTL_SECONDS || 300)
    });

    res.status(200).json({
      success: true,
      data: {
        downloadUrl,
        expiresIn: Number(process.env.SIGNED_DOWNLOAD_URL_TTL_SECONDS || 300),
        storageProvider: 's3'
      }
    });
  } catch (error) {
    logger.error(`Get Task Attachment Download URL Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error creating attachment download URL'
    });
  }
};

// @desc    Moderate a task attachment after review
// @route   PATCH /api/tasks/:taskId/attachments/:attachmentId/moderation
// @access  Private
exports.moderateTaskAttachment = async (req, res) => {
  try {
    const { scanStatus, moderationNote } = req.body;
    const allowedStatuses = ['safe', 'blocked'];

    if (!allowedStatuses.includes(scanStatus)) {
      return res.status(400).json({
        success: false,
        message: 'scanStatus must be safe or blocked'
      });
    }

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'attachmentModerate'))) return;

    const attachment = task.attachments.id(req.params.attachmentId);
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    attachment.scanStatus = scanStatus;
    attachment.moderatedBy = req.user._id;
    attachment.moderatedAt = new Date();
    attachment.moderationNote = moderationNote;
    if (scanStatus === 'blocked') {
      attachment.quarantineReason = moderationNote || 'Blocked by moderator';
    }

    await task.save();

    await AuditLog.logAction({
      user: req.user._id,
      action: 'task_updated',
      entityType: 'Task',
      entityId: task._id,
      description: `Moderated task attachment: ${attachment.filename}`,
      metadata: {
        clubId: task.club,
        additionalInfo: {
          taskId: task._id,
          attachmentId: attachment._id,
          scanStatus
        }
      }
    });

    res.status(200).json({
      success: true,
      message: 'Attachment moderation saved',
      data: attachment
    });
  } catch (error) {
    logger.error(`Moderate Task Attachment Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error moderating attachment'
    });
  }
};

// @desc    Add subtask to task
// @route   POST /api/tasks/:taskId/subtasks
// @access  Private
exports.addSubtask = async (req, res) => {
  try {
    const { title } = req.body;
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'subtask'))) return;

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        message: 'Subtask title is required'
      });
    }

    if (cleanTitle.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Subtask title cannot be more than 200 characters'
      });
    }

    task.subtasks.push({
      title: cleanTitle,
      completed: false
    });
    task.history.push({
      user: req.user._id,
      action: 'updated',
      field: 'subtasks',
      newValue: cleanTitle,
      timestamp: new Date()
    });

    await task.save();

    const updatedTask = await getPopulatedTask(task._id);

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_subtask_added', updatedTask);

    res.status(201).json({
      success: true,
      message: 'Subtask added',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Add Subtask Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error adding subtask'
    });
  }
};

// @desc    Toggle subtask completion
// @route   PATCH /api/tasks/:taskId/subtasks/:subtaskId
// @access  Private
exports.toggleSubtask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'subtask'))) return;

    const subtask = task.subtasks.id(req.params.subtaskId);
    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found'
      });
    }

    await task.toggleSubtask(req.user._id, req.params.subtaskId);

    const updatedTask = await getPopulatedTask(task._id);

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_subtask_toggled', updatedTask);

    res.status(200).json({
      success: true,
      message: 'Subtask updated',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Toggle Subtask Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error updating subtask'
    });
  }
};

// @desc    Rename subtask
// @route   PUT /api/tasks/:taskId/subtasks/:subtaskId
// @access  Private
exports.updateSubtask = async (req, res) => {
  try {
    const { title } = req.body;
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'subtask'))) return;

    const subtask = task.subtasks.id(req.params.subtaskId);
    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found'
      });
    }

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        message: 'Subtask title is required'
      });
    }

    if (cleanTitle.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Subtask title cannot be more than 200 characters'
      });
    }

    const oldTitle = subtask.title;
    subtask.title = cleanTitle;
    task.history.push({
      user: req.user._id,
      action: 'updated',
      field: `subtasks.${req.params.subtaskId}.title`,
      oldValue: oldTitle,
      newValue: cleanTitle,
      timestamp: new Date()
    });

    await task.save();

    const updatedTask = await getPopulatedTask(task._id);

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_subtask_updated', updatedTask);

    res.status(200).json({
      success: true,
      message: 'Subtask updated',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Update Subtask Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error updating subtask'
    });
  }
};

// @desc    Delete subtask
// @route   DELETE /api/tasks/:taskId/subtasks/:subtaskId
// @access  Private
exports.deleteSubtask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, task, 'subtask'))) return;

    const subtask = task.subtasks.id(req.params.subtaskId);
    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found'
      });
    }

    const oldTitle = subtask.title;
    task.subtasks.pull(req.params.subtaskId);
    task.history.push({
      user: req.user._id,
      action: 'updated',
      field: 'subtasks',
      oldValue: oldTitle,
      timestamp: new Date()
    });

    await task.save();

    const updatedTask = await getPopulatedTask(task._id);

    emitTaskEvent(req, task.club, 'taskUpdated', updatedTask);
    emitTaskEvent(req, task.club, 'task_subtask_deleted', updatedTask);

    res.status(200).json({
      success: true,
      message: 'Subtask deleted',
      data: updatedTask
    });
  } catch (error) {
    logger.error(`Delete Subtask Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error deleting subtask'
    });
  }
};

// @desc    Duplicate task
// @route   POST /api/tasks/:taskId/duplicate
// @access  Private
exports.duplicateTask = async (req, res) => {
  try {
    const originalTask = await Task.findById(req.params.taskId);

    if (!originalTask) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!(await requireTaskPermission(req, res, originalTask, 'update'))) return;

    const duplicatedTask = await Task.create({
      title: `${originalTask.title} (Copy)`,
      description: originalTask.description,
      club: originalTask.club,
      createdBy: req.user._id,
      priority: originalTask.priority,
      tags: originalTask.tags,
      estimatedHours: originalTask.estimatedHours,
      subtasks: originalTask.subtasks.map(st => ({
        title: st.title,
        completed: false
      }))
    });

    const populatedTask = await Task.findById(duplicatedTask._id)
      .populate('club', 'name logo')
      .populate('createdBy', 'name email profilePhoto');

    res.status(201).json({
      success: true,
      message: 'Task duplicated successfully',
      data: populatedTask
    });
  } catch (error) {
    logger.error(`Duplicate Task Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error duplicating task'
    });
  }
};
