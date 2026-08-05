const express = require('express');
const router = express.Router();
const {
  getClubOverview,
  getTaskAnalytics,
  getTaskCounts,
  getMemberProductivity,
  getDashboardData
} = require('../controllers/analytics.controller');
const { protect, requireClubMembership } = require('../middleware/auth');
const { cacheResponse } = require('../middlewares/cache');
const { keys } = require('../services/cache.service');

router.get('/club/:clubId/overview', protect, requireClubMembership, cacheResponse({ key: (req) => keys.overview(req.params.clubId), ttlSeconds: 60 }), getClubOverview);
router.get('/club/:clubId/tasks', protect, requireClubMembership, cacheResponse({ key: (req) => keys.taskAnalytics(req.params.clubId), ttlSeconds: 60 }), getTaskAnalytics);
router.get('/club/:clubId/task-counts', protect, requireClubMembership, cacheResponse({ key: (req) => keys.taskCounts(req.params.clubId), ttlSeconds: 30 }), getTaskCounts);
router.get('/club/:clubId/members', protect, requireClubMembership, getMemberProductivity);
router.get('/overview', protect, requireClubMembership, getClubOverview);
router.get('/tasks', protect, requireClubMembership, getTaskAnalytics);
router.get('/productivity', protect, requireClubMembership, getMemberProductivity);
router.get('/dashboard', protect, cacheResponse({ key: (req) => keys.dashboard(req.user._id), ttlSeconds: 30 }), getDashboardData);

module.exports = router;
