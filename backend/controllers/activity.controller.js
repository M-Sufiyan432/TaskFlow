const Task = require('../models/Task.model');
const Club = require('../models/Club.model');
const { listClubActivities, listTaskActivities } = require('../services/activity.service');
const { PERMISSIONS, can } = require('../services/permission.service');
const { logger } = require('../config/logger');

exports.getTaskTimeline = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const decision = await can(req.user, PERMISSIONS.ACTIVITY_VIEW, { task });
    if (!decision.allowed) {
      return res.status(403).json({
        success: false,
        message: decision.reason || 'Not authorized to view task timeline'
      });
    }

    const result = await listTaskActivities({
      taskId: task._id,
      limit: req.query.limit,
      before: req.query.before
    });

    res.status(200).json({
      success: true,
      data: result.data,
      activities: result.data,
      pageInfo: result.pageInfo
    });
  } catch (error) {
    logger.error(`Get Task Timeline Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching task timeline'
    });
  }
};

exports.getClubTimeline = async (req, res) => {
  try {
    const club = await Club.findById(req.params.clubId);
    if (!club) {
      return res.status(404).json({
        success: false,
        message: 'Club not found'
      });
    }

    const decision = await can(req.user, PERMISSIONS.ACTIVITY_VIEW, { club });
    if (!decision.allowed) {
      return res.status(403).json({
        success: false,
        message: decision.reason || 'Not authorized to view club timeline'
      });
    }

    const result = await listClubActivities({
      clubId: club._id,
      limit: req.query.limit,
      before: req.query.before
    });

    res.status(200).json({
      success: true,
      data: result.data,
      activities: result.data,
      pageInfo: result.pageInfo
    });
  } catch (error) {
    logger.error(`Get Club Timeline Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error fetching club timeline'
    });
  }
};
