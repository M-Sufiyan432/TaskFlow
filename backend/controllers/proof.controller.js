const Task = require('../models/Task.model');
const ProofSubmission = require('../models/ProofSubmission.model');
const { can, PERMISSIONS, idsMatch } = require('../services/permission.service');
const { createActivity } = require('../services/activity.service');
const { recordAudit } = require('../services/audit.service');
const { logger } = require('../config/logger');

const emit = (req, clubId, name, payload) => req.app.get('io')?.to(`club_${clubId}`).emit(name, payload);
const taskFor = (id) => Task.findById(id).select('club title assignedTo createdBy attachments status');
const hasTaskAccess = (task, userId) => idsMatch(task.createdBy, userId) || task.assignedTo.some((id) => idsMatch(id, userId));

exports.submitProof = async (req, res) => {
  try {
    const task = await taskFor(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const decision = await can(req.user, PERMISSIONS.PROOF_SUBMIT, { task });
    if (!decision.allowed || !hasTaskAccess(task, req.user._id)) return res.status(403).json({ success: false, message: 'Only task participants can submit proof' });
    const { attachmentIds = [], comment } = req.body;
    const attachments = task.attachments.filter((attachment) => attachmentIds.map(String).includes(String(attachment._id)))
      .map((attachment) => ({ attachmentId: attachment._id, filename: attachment.filename, url: attachment.url, storageKey: attachment.storageKey, fileType: attachment.fileType }));
    if (!attachments.length && !String(comment || '').trim()) return res.status(400).json({ success: false, message: 'Attach proof or include a submission comment' });
    const proof = await ProofSubmission.create({ club: task.club, task: task._id, submittedBy: req.user._id, comment: String(comment || '').trim(), attachments, history: [{ action: 'submitted', actor: req.user._id, comment: String(comment || '').trim(), attachments }] });
    await createActivity({ req, task, type: 'proof.submitted', summary: `Submitted proof for "${task.title}"`, metadata: { proofId: proof._id, attachmentCount: attachments.length } });
    await recordAudit({ user: req.user._id, action: 'proof_submitted', entityType: 'ProofSubmission', entityId: proof._id, description: `Submitted proof for task: ${task.title}`, metadata: { clubId: task.club, additionalInfo: { taskId: task._id } } });
    emit(req, task.club, 'proof_submitted', proof);
    return res.status(201).json({ success: true, data: proof });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'A proof submission is already awaiting review' });
    logger.error('Submit proof error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Unable to submit proof' });
  }
};

exports.reviewProof = async (req, res) => {
  try {
    const proof = await ProofSubmission.findById(req.params.proofId);
    if (!proof) return res.status(404).json({ success: false, message: 'Proof submission not found' });
    const task = await taskFor(proof.task);
    const decision = await can(req.user, PERMISSIONS.PROOF_REVIEW, { task });
    if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Only club leaders can review proof' });
    if (proof.status !== 'pending') return res.status(409).json({ success: false, message: 'This proof submission has already been reviewed' });
    const { decision: reviewDecision, comment } = req.body;
    if (!['approved', 'rejected'].includes(reviewDecision)) return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    if (reviewDecision === 'rejected' && !String(comment || '').trim()) return res.status(400).json({ success: false, message: 'A rejection comment is required' });
    proof.status = reviewDecision; proof.reviewedBy = req.user._id; proof.reviewedAt = new Date(); proof.rejectionComment = reviewDecision === 'rejected' ? String(comment).trim() : undefined;
    proof.history.push({ action: reviewDecision, actor: req.user._id, comment: String(comment || '').trim() }); await proof.save();
    await createActivity({ req, task, type: `proof.${reviewDecision}`, summary: `${reviewDecision === 'approved' ? 'Approved' : 'Rejected'} proof for "${task.title}"`, metadata: { proofId: proof._id, rejectionComment: proof.rejectionComment } });
    await recordAudit({ user: req.user._id, action: reviewDecision === 'approved' ? 'proof_approved' : 'proof_rejected', entityType: 'ProofSubmission', entityId: proof._id, description: `${reviewDecision} proof for task: ${task.title}`, metadata: { clubId: task.club, additionalInfo: { taskId: task._id, comment: proof.rejectionComment } } });
    emit(req, task.club, 'proof_reviewed', proof);
    return res.json({ success: true, data: proof });
  } catch (error) { logger.error('Review proof error', { error: error.message }); return res.status(500).json({ success: false, message: 'Unable to review proof' }); }
};

exports.listProofs = async (req, res) => {
  const task = await taskFor(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
  const decision = await can(req.user, PERMISSIONS.TASK_VIEW, { task });
  if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason || 'Not authorized' });
  const data = await ProofSubmission.find({ task: task._id }).populate('submittedBy reviewedBy', 'name email profilePhoto').populate('history.actor', 'name email').sort({ createdAt: -1 }).lean();
  return res.json({ success: true, data });
};
