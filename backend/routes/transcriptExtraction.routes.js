const router = require('express').Router(); const { protect } = require('../middleware/auth');
const { requestExtraction, getExtraction, approveExtraction } = require('../controllers/transcriptExtraction.controller');
router.post('/transcript-extractions', protect, requestExtraction); router.get('/transcript-extractions/:jobId', protect, getExtraction); router.post('/transcript-extractions/:jobId/approve', protect, approveExtraction);
module.exports = router;
