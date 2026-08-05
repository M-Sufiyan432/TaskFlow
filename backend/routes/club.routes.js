const express = require('express');
const router = express.Router();
const {
  getAllClubs,
  createClub,
  getClubById,
  updateClub,
  deleteClub,
  joinClub,
  leaveClub,
  getClubMembers,
  addMember,
  removeMember,
  updateMemberRole,
  generateInviteLink,
  transferOwnership
} = require('../controllers/club.controller');
const { protect, requireClubAdmin, requireClubPresident, optionalAuth } = require('../middleware/auth');
const { createClubValidation, updateClubValidation, validate } = require('../middleware/validation');
const {
  getTasksByClub,
  createTask
} = require('../controllers/task.controller');
const { createTaskValidation } = require('../middleware/validation');
const { requireTaskCreatePermission } = require('../middlewares/taskPermissions');
const { cacheResponse } = require('../middlewares/cache');
const { keys } = require('../services/cache.service');

router.get('/', optionalAuth, getAllClubs);
router.post('/', protect, createClubValidation, validate, createClub);
router.get('/:clubId/tasks', protect, getTasksByClub);
router.post('/:clubId/tasks', protect, (req, _res, next) => {
  req.body.club = req.params.clubId;
  next();
}, requireTaskCreatePermission, createTaskValidation, validate, createTask);
router.get('/:clubId', optionalAuth, cacheResponse({ key: (req) => keys.club(req.params.clubId), ttlSeconds: 120 }), getClubById);
router.put('/:clubId', protect, requireClubAdmin, updateClubValidation, validate, updateClub);
router.delete('/:clubId', protect, requireClubPresident, deleteClub);
router.post('/:clubId/join', protect, joinClub);
router.post('/:clubId/leave', protect, leaveClub);
router.get('/:clubId/members', protect, getClubMembers);
router.post('/:clubId/members', protect, requireClubAdmin, addMember);
router.delete('/:clubId/members/:userId', protect, requireClubAdmin, removeMember);
router.put('/:clubId/members/:userId/role', protect, requireClubAdmin, updateMemberRole);
router.post('/:clubId/invite', protect, requireClubAdmin, generateInviteLink);
router.post('/:clubId/transfer', protect, requireClubPresident, transferOwnership);

module.exports = router;
