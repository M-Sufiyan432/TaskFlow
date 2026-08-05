const MAX_TASKS = 30;
const outputSchema = {
  type: 'object', additionalProperties: false, required: ['tasks'], properties: {
    tasks: { type: 'array', maxItems: MAX_TASKS, items: { type: 'object', additionalProperties: false,
      required: ['title', 'description', 'dueDate', 'priority', 'assigneeIds', 'evidence', 'confidence'], properties: {
        title: { type: 'string' }, description: { type: 'string' }, dueDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, assigneeIds: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }
      } } }
  }
};
const prompt = `Extract only explicit or strongly implied actionable commitments from this meeting transcript. Do not turn discussion topics into tasks. Use null for unknown dates and only the supplied member IDs for assignees. Confidence measures evidence in the transcript, not task importance. Include a short evidence quote or paraphrase.`;
const extractTasks = async (job) => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    model: process.env.OPENAI_TRANSCRIPT_MODEL || 'gpt-4.1-mini', input: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ meetingDate: job.context?.meetingDate, memberIds: job.context?.assigneeIds || [], transcript: job.transcript }) }],
    text: { format: { type: 'json_schema', name: 'meeting_tasks', strict: true, schema: outputSchema } }, max_output_tokens: 3000
  }) });
  if (!response.ok) throw new Error(`AI provider failed with status ${response.status}`);
  const body = await response.json(); const parsed = JSON.parse(body.output_text);
  const allowed = new Set((job.context?.assigneeIds || []).map(String));
  const tasks = (parsed.tasks || []).slice(0, MAX_TASKS).map((task) => ({
    title: String(task.title || '').trim().slice(0, 200), description: String(task.description || '').trim().slice(0, 2000),
    dueDate: task.dueDate && !Number.isNaN(new Date(task.dueDate).getTime()) ? new Date(task.dueDate) : undefined,
    priority: task.priority, assigneeIds: (task.assigneeIds || []).filter((id) => allowed.has(String(id))), evidence: String(task.evidence || '').slice(0, 500), confidence: Math.max(0, Math.min(1, Number(task.confidence) || 0))
  })).filter((task) => task.title && task.confidence >= Number(process.env.TRANSCRIPT_TASK_MIN_CONFIDENCE || 0.45));
  return { tasks, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens, model: body.model } };
};
module.exports = { extractTasks };
