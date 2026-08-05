const MAX_SUBTASKS = 20;

const breakdownSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'subtasks'],
  properties: {
    summary: { type: 'string' },
    subtasks: {
      type: 'array',
      maxItems: MAX_SUBTASKS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'rationale', 'dueOffsetDays', 'priority', 'suggestedAssigneeId'],
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          dueOffsetDays: { type: 'integer', minimum: 0, maximum: 365 },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          suggestedAssigneeId: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        }
      }
    }
  }
};

const systemPrompt = `You break club projects into practical tasks. Return only JSON with {summary, subtasks}. Each subtask must have title, rationale, dueOffsetDays (integer 0-365), priority (low|medium|high|critical), and suggestedAssigneeId (one provided ID or null). Never invent people, dates, budgets, contact details, or facts.`;

const buildRequest = (job) => ({
  model: process.env.OPENAI_TASK_BREAKDOWN_MODEL || 'gpt-4.1-mini',
  input: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify({ task: job.prompt, dueDate: job.context?.dueDate, availableAssigneeIds: job.context?.assigneeIds || [] }) }
  ],
  text: { format: { type: 'json_schema', name: 'task_breakdown', strict: true, schema: breakdownSchema } },
  max_output_tokens: 1800
});

const validateResult = (value, allowedAssigneeIds) => {
  if (!value || !Array.isArray(value.subtasks) || value.subtasks.length === 0) throw new Error('AI response has no subtasks');
  const allowed = new Set(allowedAssigneeIds.map(String));
  return {
    summary: String(value.summary || '').slice(0, 1000),
    subtasks: value.subtasks.slice(0, MAX_SUBTASKS).map((item) => ({
      title: String(item.title || '').trim().slice(0, 200),
      rationale: String(item.rationale || '').trim().slice(0, 500),
      dueOffsetDays: Math.max(0, Math.min(365, Number.parseInt(item.dueOffsetDays, 10) || 0)),
      priority: ['low', 'medium', 'high', 'critical'].includes(item.priority) ? item.priority : 'medium',
      suggestedAssigneeId: item.suggestedAssigneeId && allowed.has(String(item.suggestedAssigneeId)) ? item.suggestedAssigneeId : null
    })).filter((item) => item.title)
  };
};

const generateBreakdown = async (job) => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(job))
  });
  if (!response.ok) throw new Error(`AI provider failed with status ${response.status}`);
  const body = await response.json();
  const output = body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('');
  return { result: validateResult(JSON.parse(output), job.context?.assigneeIds || []), usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens, model: body.model } };
};

module.exports = { generateBreakdown };
