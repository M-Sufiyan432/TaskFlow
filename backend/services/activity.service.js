const Activity = require('../models/Activity.model');

const createActivity = async ({
  req,
  task,
  type,
  summary,
  metadata = {},
  changes
}) => Activity.create({
  club: task.club?._id || task.club,
  task: task._id,
  actor: req.user._id,
  type,
  summary,
  metadata,
  changes,
  requestId: req.requestId
});

const buildCursorQuery = (before) => {
  if (!before) return {};
  const [createdAt, id] = String(before).split('_');
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return {};
  if (!id) return { createdAt: { $lt: timestamp } };
  return { $or: [{ createdAt: { $lt: timestamp } }, { createdAt: timestamp, _id: { $lt: id } }] };
};

const listActivities = async ({ query, limit = 30, before, populateTask = false }) => {
  const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const activityQuery = Activity.find({ ...query, ...buildCursorQuery(before) })
    .populate('actor', 'name email profilePhoto');
  if (populateTask) activityQuery.populate('task', 'title status priority');
  const activities = await activityQuery
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const hasMore = activities.length > pageSize;
  const data = hasMore ? activities.slice(0, pageSize) : activities;
  const last = data[data.length - 1];
  return { data, pageInfo: { hasMore, nextCursor: hasMore && last ? `${last.createdAt.toISOString()}_${last._id}` : null } };
};

const listTaskActivities = ({ taskId, limit = 30, before }) => {
  return listActivities({ query: { task: taskId }, limit, before });
};

const listClubActivities = ({ clubId, limit = 30, before }) => {
  return listActivities({ query: { club: clubId }, limit, before, populateTask: true });
};

module.exports = {
  createActivity,
  listClubActivities,
  listTaskActivities
};
