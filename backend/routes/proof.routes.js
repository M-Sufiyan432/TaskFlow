const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { submitProof, reviewProof, listProofs } = require('../controllers/proof.controller');
router.post('/tasks/:taskId/proofs', protect, submitProof);
router.get('/tasks/:taskId/proofs', protect, listProofs);
router.post('/proofs/:proofId/review', protect, reviewProof);
module.exports = router;
