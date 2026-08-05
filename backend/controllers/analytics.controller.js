const Task = require('../models/Task.model');
const Event = require('../models/Event.model');
const Club = require('../models/Club.model');
const { logger } = require('../config/logger');
const mongoose = require('mongoose');

const resolveClubId = (req) =>
  req.params.clubId || req.body.clubId || req.body.club || req.headers['x-club-id'];

const toObjectId = (value) => (mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null);

exports.getClubOverview = async (req, res) => {
  try {
    const clubId = resolveClubId(req);
    if (!clubId) {
      return res.status(400).json({ success: false, message: 'Club ID is required' });
    }

    const club = await Club.findById(clubId).select('members').lean();
    
    if (!club) {
      return res.status(404).json({ success: false, message: 'Club not found' });
    }

    const [taskMetrics, totalEvents, upcomingEvents] = await Promise.all([
      Task.aggregate([
        { $match: { club: club._id, isArchived: false } },
        { $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdueTasks: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'completed'] }, { $lt: ['$dueDate', new Date()] }] }, 1, 0] } }
        } }
      ]),
      Event.countDocuments({ club: club._id }),
      Event.countDocuments({
        club: club._id,
        startDate: { $gt: new Date() }
      })
    ]);
    const metrics = taskMetrics[0] || { totalTasks: 0, completedTasks: 0, overdueTasks: 0 };

    res.status(200).json({
      success: true,
      data: {
        totalMembers: Array.isArray(club.members) ? club.members.length : 0,
        totalTasks: metrics.totalTasks,
        completedTasks: metrics.completedTasks,
        overdueTasks: metrics.overdueTasks,
        completionRate: metrics.totalTasks > 0 ? ((metrics.completedTasks / metrics.totalTasks) * 100).toFixed(2) : 0,
        totalEvents,
        upcomingEvents
      }
    });
  } catch (error) {
    logger.error(`Get Club Overview Error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
};

exports.getTaskAnalytics = async (req, res) => {
  try {
    const clubId = resolveClubId(req);
    const clubObjectId = toObjectId(clubId);

    if (!clubObjectId) {
      return res.status(400).json({ success: false, message: 'Invalid club ID' });
    }

    const [analytics] = await Task.aggregate([
      { $match: { club: clubObjectId, isArchived: false } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }]
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        byStatus: analytics?.byStatus || [],
        byPriority: analytics?.byPriority || []
      }
    });
  } catch (error) {
    logger.error(`Get Task Analytics Error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching task analytics' });
  }
};

exports.getTaskCounts = async (req, res) => {
  try {
    const clubId = resolveClubId(req);
    const clubObjectId = toObjectId(clubId);
    if (!clubObjectId) return res.status(400).json({ success: false, message: 'Invalid club ID' });
    const counts = await Task.aggregate([
      { $match: { club: clubObjectId, isArchived: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const data = counts.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), { todo: 0, inprogress: 0, review: 0, completed: 0 });
    return res.status(200).json({ success: true, data: { ...data, total: Object.values(data).reduce((sum, count) => sum + count, 0) } });
  } catch (error) { logger.error(`Get Task Counts Error: ${error.message}`); return res.status(500).json({ success: false, message: 'Error fetching task counts' }); }
};

exports.getMemberProductivity = async (req, res) => {
  try {
    const clubId = resolveClubId(req);
    const clubObjectId = toObjectId(clubId);

    if (!clubObjectId) {
      return res.status(400).json({ success: false, message: 'Invalid club ID' });
    }

    const productivity = await Task.aggregate([
      { $match: { club: clubObjectId, isArchived: false } },
      { $unwind: '$assignedTo' },
      {
        $group: {
          _id: '$assignedTo',
          tasksAssigned: { $sum: 1 },
          tasksCompleted: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          name: '$user.name',
          email: '$user.email',
          profilePhoto: '$user.profilePhoto',
          tasksAssigned: 1,
          tasksCompleted: 1,
          completionRate: {
            $cond: [
              { $eq: ['$tasksAssigned', 0] },
              0,
              { $multiply: [{ $divide: ['$tasksCompleted', '$tasksAssigned'] }, 100] }
            ]
          }
        }
      }
    ]);

    res.status(200).json({ success: true, data: productivity });
  } catch (error) {
    logger.error(`Get Member Productivity Error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching productivity' });
  }
};

exports.getDashboardData = async (req, res) => {
  try {
    const [myTasks, upcomingEvents] = await Promise.all([
      Task.find({
        assignedTo: req.user._id,
        isArchived: false
      })
        .populate('club', 'name logo')
        .limit(10)
        .sort({ dueDate: 1 })
        .lean(),
      Event.find({
        'rsvp.responses.user': req.user._id,
        startDate: { $gt: new Date() }
      })
        .populate('club', 'name logo')
        .limit(5)
        .sort({ startDate: 1 })
        .lean()
    ]);

    res.status(200).json({
      success: true,
      data: {
        myTasks,
        upcomingEvents
      }
    });
  } catch (error) {
    logger.error(`Get Dashboard Error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching dashboard' });
  }
};

module.exports = exports;
