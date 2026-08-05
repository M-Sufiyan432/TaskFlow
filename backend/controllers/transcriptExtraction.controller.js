const Club = require('../models/Club.model');
const Task = require('../models/Task.model');
const TranscriptExtractionJob = require('../models/TranscriptExtractionJob.model');
const { can, PERMISSIONS } = require('../services/permission.service');
const { enqueueTranscriptExtraction, isQueueEnabled } = require('../jobs');
const { recordAudit } = require('../services/audit.service');
const { invalidateClub, invalidateDashboard } = require('../services/cache.service');
const { logger } = require('../config/logger');

const findJob = (id) => TranscriptExtractionJob.findById(id).select('+transcript');
exports.requestExtraction = async (req, res) => {
  try {
    const { clubId, transcript, meetingDate, assigneeIds = [] } = req.body;
    if (!clubId || !String(transcript || '').trim()) return res.status(400).json({ success: false, message: 'clubId and transcript are required' });
    if (String(transcript).length > 50000) return res.status(400).json({ success: false, message: 'Transcript cannot exceed 50,000 characters' });
    const club = await Club.findById(clubId); const decision = await can(req.user, PERMISSIONS.AI_BREAKDOWN_CREATE, { club });
    if (!club || !decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
    const memberIds = new Set(club.members.map((member) => String(member.user))); const validAssigneeIds = assigneeIds.filter((id) => memberIds.has(String(id)));
    const job = await TranscriptExtractionJob.create({ club: club._id, requestedBy: req.user._id, transcript: String(transcript).trim(), context: { meetingDate: meetingDate || undefined, assigneeIds: validAssigneeIds } });
    if (!isQueueEnabled()) return res.status(503).json({ success: false, message: 'AI processing is unavailable', data: job });
    await enqueueTranscriptExtraction({ extractionJobId: job._id }, { jobId: `transcript-extraction:${job._id}` });
    await recordAudit({ user: req.user._id, action: 'ai_breakdown_requested', entityType: 'TranscriptExtractionJob', entityId: job._id, description: 'Requested meeting transcript extraction', metadata: { clubId: club._id } });
    return res.status(202).json({ success: true, data: job });
  } catch (error) { logger.error('Transcript extraction request error', { error: error.message }); return res.status(500).json({ success: false, message: 'Unable to queue transcript extraction' }); }
};
exports.getExtraction = async (req, res) => {
  const job = await TranscriptExtractionJob.findById(req.params.jobId); if (!job) return res.status(404).json({ success: false, message: 'Extraction job not found' });
  const club = await Club.findById(job.club); const decision = await can(req.user, PERMISSIONS.TASK_VIEW, { club }); if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
  return res.json({ success: true, data: job });
};
exports.approveExtraction = async (req, res) => {
  try {
    const job = await findJob(req.params.jobId); if (!job) return res.status(404).json({ success: false, message: 'Extraction job not found' });
    const club = await Club.findById(job.club); const decision = await can(req.user, PERMISSIONS.TASK_CREATE, { club }); if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
    if (job.status !== 'ready_for_approval') return res.status(409).json({ success: false, message: 'Only completed extraction proposals can be approved' });
    const approvedIds = new Set((req.body.taskIds || job.tasks.filter((task) => task.approved).map((task) => task._id)).map(String));
    const selected = job.tasks.filter((task) => approvedIds.has(String(task._id))); if (!selected.length) return res.status(400).json({ success: false, message: 'Select at least one extracted task' });
    const tasks = await Task.insertMany(selected.map((item) => ({ title: item.title, description: item.description, club: job.club, createdBy: req.user._id, assignedTo: item.assigneeIds, dueDate: item.dueDate, priority: item.priority, history: [{ user: req.user._id, action: 'created' }] })));
    job.status = 'approved'; job.approvedBy = req.user._id; job.approvedAt = new Date(); job.tasks.forEach((task) => { task.approved = approvedIds.has(String(task._id)); }); await job.save();
    await invalidateClub(job.club); await invalidateDashboard(selected.flatMap((task) => task.assignedTo));
    await recordAudit({ user: req.user._id, action: 'ai_breakdown_requested', entityType: 'TranscriptExtractionJob', entityId: job._id, description: `Approved ${tasks.length} transcript-extracted tasks`, metadata: { clubId: job.club, additionalInfo: { taskIds: tasks.map((task) => task._id) } } });
    return res.status(201).json({ success: true, data: tasks });
  } catch (error) { logger.error('Transcript extraction approval error', { error: error.message }); return res.status(500).json({ success: false, message: 'Unable to approve extracted tasks' }); }
};
