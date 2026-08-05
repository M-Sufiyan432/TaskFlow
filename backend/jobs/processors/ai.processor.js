const AiTaskBreakdownJob = require('../../models/AiTaskBreakdownJob.model');
const { generateBreakdown } = require('../../services/aiBreakdown.service');
const TranscriptExtractionJob = require('../../models/TranscriptExtractionJob.model');
const { extractTasks } = require('../../services/transcriptExtraction.service');
const JOB_NAMES = require('../jobNames');

const processAiJob = async (job) => {
  if (job.name === JOB_NAMES.AI_TRANSCRIPT_EXTRACTION) {
    const extraction = await TranscriptExtractionJob.findById(job.data.extractionJobId).select('+transcript');
    if (!extraction || extraction.status === 'ready_for_approval' || extraction.status === 'approved') return { skipped: true };
    extraction.status = 'processing'; await extraction.save();
    try { const { tasks, usage } = await extractTasks(extraction); extraction.status = 'ready_for_approval'; extraction.tasks = tasks; extraction.usage = usage; await extraction.save(); return { extractionJobId: extraction._id, tasks: tasks.length }; }
    catch (error) { extraction.status = 'failed'; extraction.error = { code: 'AI_EXTRACTION_FAILED', message: error.message.slice(0, 500) }; await extraction.save(); throw error; }
  }
  if (job.name !== JOB_NAMES.AI_TASK_BREAKDOWN) throw new Error(`Unknown AI job: ${job.name}`);
  const breakdown = await AiTaskBreakdownJob.findById(job.data.breakdownJobId);
  if (!breakdown || breakdown.status === 'completed') return { skipped: true };
  breakdown.status = 'processing'; await breakdown.save();
  try {
    const { result, usage } = await generateBreakdown(breakdown);
    breakdown.status = 'completed'; breakdown.result = result; breakdown.usage = usage; await breakdown.save();
    return { breakdownJobId: breakdown._id, subtasks: result.subtasks.length };
  } catch (error) {
    breakdown.status = 'failed'; breakdown.error = { code: 'AI_GENERATION_FAILED', message: error.message.slice(0, 500) }; await breakdown.save();
    throw error;
  }
};
module.exports = processAiJob;
