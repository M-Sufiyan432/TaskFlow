const Club = require('../models/Club.model');
const AiTaskBreakdownJob = require('../models/AiTaskBreakdownJob.model');
const { can, PERMISSIONS } = require('../services/permission.service');
const { enqueueAiTaskBreakdown, isQueueEnabled } = require('../jobs');
const { recordAudit } = require('../services/audit.service');
const { logger } = require('../config/logger');

exports.requestBreakdown = async (req, res) => {
  try {
    const { clubId, prompt, dueDate, assigneeIds = [] } = req.body;
    if (!clubId || !String(prompt || '').trim()) return res.status(400).json({ success: false, message: 'clubId and prompt are required' });
    const club = await Club.findById(clubId);
    const decision = await can(req.user, PERMISSIONS.AI_BREAKDOWN_CREATE, { club });
    if (!club || !decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
    const memberIds = new Set(club.members.map((member) => String(member.user)));
    const validAssigneeIds = assigneeIds.filter((id) => memberIds.has(String(id)));
    const job = await AiTaskBreakdownJob.create({ club: club._id, requestedBy: req.user._id, prompt: String(prompt).trim(), context: { dueDate: dueDate || undefined, assigneeIds: validAssigneeIds } });
    if (!isQueueEnabled()) return res.status(503).json({ success: false, message: 'AI processing is currently unavailable', data: job });
    await enqueueAiTaskBreakdown({ breakdownJobId: job._id }, { jobId: `ai-breakdown:${job._id}` });
    await recordAudit({ user: req.user._id, action: 'ai_breakdown_requested', entityType: 'AiTaskBreakdownJob', entityId: job._id, description: 'Requested AI task breakdown', metadata: { clubId: club._id } });
    return res.status(202).json({ success: true, data: job });
  } catch (error) { logger.error('AI breakdown request error', { error: error.message }); return res.status(500).json({ success: false, message: 'Unable to queue AI breakdown' }); }
};
exports.getBreakdown = async (req, res) => {
  const job = await AiTaskBreakdownJob.findById(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, message: 'Breakdown job not found' });
  const club = await Club.findById(job.club); const decision = await can(req.user, PERMISSIONS.TASK_VIEW, { club });
  if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
  return res.json({ success: true, data: job });
};
