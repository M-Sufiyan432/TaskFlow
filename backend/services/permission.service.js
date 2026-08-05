const Club = require('../models/Club.model');

const ROLES = {
  ADMIN: 'admin',
  PRESIDENT: 'president',
  VICE_PRESIDENT: 'vicepresident',
  SECRETARY: 'secretary',
  MEMBER: 'member'
};

const GLOBAL_ADMIN_ROLES = ['admin', 'superadmin', 'super_admin'];

const PERMISSIONS = {
  CLUB_VIEW: 'club:view',
  CLUB_MANAGE: 'club:manage',
  TASK_VIEW: 'task:view',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_ASSIGN: 'task:assign',
  TASK_STATUS_UPDATE: 'task:status:update',
  COMMENT_CREATE: 'comment:create',
  ATTACHMENT_UPLOAD: 'attachment:upload',
  ATTACHMENT_VIEW: 'attachment:view',
  ATTACHMENT_MODERATE: 'attachment:moderate',
  ACTIVITY_VIEW: 'activity:view',
  PROOF_SUBMIT: 'proof:submit',
  PROOF_REVIEW: 'proof:review',
  AI_BREAKDOWN_CREATE: 'ai:breakdown:create'
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.PRESIDENT]: Object.values(PERMISSIONS),
  [ROLES.VICE_PRESIDENT]: [
    PERMISSIONS.CLUB_VIEW,
    PERMISSIONS.CLUB_MANAGE,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_UPDATE,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_STATUS_UPDATE,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.ATTACHMENT_UPLOAD,
    PERMISSIONS.ATTACHMENT_VIEW,
    PERMISSIONS.ATTACHMENT_MODERATE,
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.PROOF_REVIEW,
    PERMISSIONS.AI_BREAKDOWN_CREATE
  ],
  [ROLES.SECRETARY]: [
    PERMISSIONS.CLUB_VIEW,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_UPDATE,
    PERMISSIONS.TASK_STATUS_UPDATE,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.ATTACHMENT_UPLOAD,
    PERMISSIONS.ATTACHMENT_VIEW,
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.PROOF_REVIEW,
    PERMISSIONS.AI_BREAKDOWN_CREATE
  ],
  [ROLES.MEMBER]: [
    PERMISSIONS.CLUB_VIEW,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_STATUS_UPDATE,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.ATTACHMENT_UPLOAD,
    PERMISSIONS.ATTACHMENT_VIEW,
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.PROOF_SUBMIT
  ]
};

const idsMatch = (left, right) => left?.toString() === right?.toString();

const isGlobalAdmin = (user) => GLOBAL_ADMIN_ROLES.includes(user?.role);

const getClubRole = (club, userId) => {
  const member = club?.members?.find((entry) => idsMatch(entry.user, userId));
  return member?.role || null;
};

const hasRolePermission = (role, permission) =>
  Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));

const isTaskAssignee = (task, userId) =>
  Array.isArray(task?.assignedTo) && task.assignedTo.some((assigneeId) => idsMatch(assigneeId, userId));

const isTaskCreator = (task, userId) => idsMatch(task?.createdBy, userId);

const loadClub = async (clubOrId) => {
  if (!clubOrId) return null;
  if (clubOrId.members) return clubOrId;
  return Club.findById(clubOrId);
};

const can = async (user, permission, context = {}) => {
  if (!user) return { allowed: false, reason: 'Authentication required' };
  if (isGlobalAdmin(user)) return { allowed: true, role: ROLES.ADMIN };

  const clubId = context.clubId || context.task?.club?._id || context.task?.club;
  const club = context.club || await loadClub(clubId);
  const role = getClubRole(club, user._id || user.id);

  if (!role) return { allowed: false, reason: 'Club membership required' };
  if (!hasRolePermission(role, permission)) {
    return { allowed: false, role, reason: 'Role does not include this permission' };
  }

  const userId = user._id || user.id;
  const task = context.task;
  const scopedTaskPermission = [
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_STATUS_UPDATE,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.ATTACHMENT_UPLOAD,
    PERMISSIONS.ATTACHMENT_VIEW,
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.PROOF_SUBMIT
  ].includes(permission);

  if (task && role === ROLES.MEMBER && scopedTaskPermission) {
    const participant = isTaskAssignee(task, userId) || isTaskCreator(task, userId);
    if (!participant) {
      return { allowed: false, role, reason: 'Task participant access required' };
    }
  }

  if (permission === PERMISSIONS.TASK_UPDATE && role === ROLES.MEMBER) {
    return { allowed: false, role, reason: 'Members cannot edit task metadata' };
  }

  return { allowed: true, role };
};

const assertPermission = async (user, permission, context = {}) => {
  const decision = await can(user, permission, context);
  if (!decision.allowed) {
    const error = new Error(decision.reason || 'Forbidden');
    error.statusCode = 403;
    error.permission = permission;
    throw error;
  }
  return decision;
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  assertPermission,
  can,
  getClubRole,
  hasRolePermission,
  idsMatch,
  isGlobalAdmin,
  isTaskAssignee,
  isTaskCreator
};
