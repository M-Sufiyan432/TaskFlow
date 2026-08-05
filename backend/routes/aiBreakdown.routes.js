const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requestBreakdown, getBreakdown } = require('../controllers/aiBreakdown.controller');
router.post('/task-breakdowns', protect, requestBreakdown);
router.get('/task-breakdowns/:jobId', protect, getBreakdown);
module.exports = router;
