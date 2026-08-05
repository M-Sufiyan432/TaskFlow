# Activity, approvals, and AI task breakdown

## Activity timeline

`Activity` is an append-only operational event stream. The command handlers write the task state first and then publish a small, query-oriented activity record with actor, task, club, type, request correlation ID, and redacted metadata. This is event-inspired rather than full event sourcing: Mongo task documents remain the command-side source of truth, while activity is an immutable read model. That choice keeps normal task reads simple while preserving an auditable timeline.

Timeline reads use cursor pagination (`createdAt_objectId`) and compound indexes on `(task, createdAt, _id)` and `(club, createdAt, _id)`. The API returns `pageInfo.nextCursor`; clients should pass it as `before`, avoiding expensive offset scans. `GET /api/tasks/:taskId/timeline` and `GET /api/activity/clubs/:clubId/timeline` expose the feed.

Events are generated at command boundaries: task creation, assignment, status transition, comment addition, attachment upload, proof submission/review, and AI job lifecycle. Keep metadata non-sensitive and render human text from trusted event types where possible. `AuditLog` serves compliance and retention use cases; `Activity` is optimized for product UI.

## Proof approval lifecycle

Proof is its own aggregate, not an attachment flag. A participant creates a `pending` submission with selected task attachments and an immutable `submitted` history entry. A leader transitions it once to `approved` or `rejected`; rejection requires a comment. Optimistic concurrency plus a partial unique index allow only one pending submission per task, preventing double review races. Each transition writes activity and audit records and emits a club socket event.

Endpoints: `POST /api/tasks/:taskId/proofs`, `GET /api/tasks/:taskId/proofs`, and `POST /api/proofs/:proofId/review` with `{ decision: "approved"|"rejected", comment? }`.

Enterprise workflow systems separate the current state from its transition log, authorize every transition, require reasons for negative outcomes, and preserve reviewer identity/time. This implementation follows that shape while remaining ready for later additions such as escalation SLAs, multiple approvers, or delegated review.

## AI breakdown

`POST /api/ai/task-breakdowns` accepts `{ clubId, prompt, dueDate?, assigneeIds? }` and returns `202` with a job ID. The BullMQ worker calls the model, requires JSON, validates bounded subtasks/priorities/due offsets, and only permits assignment suggestions from supplied club member IDs. Clients poll `GET /api/ai/task-breakdowns/:jobId`, then let a human accept the proposal into real task commands.

AI work is queued because inference is variable-latency, retriable, rate-limited, and should not hold an HTTP request or database transaction open. The request contains compact structured context rather than full club history, output is capped, and suggestions are validated before storage. The system prompt disallows invented people or facts; production deployments should also apply input limits, moderation before enqueueing, audit prompts by hash/redaction policy, and keep provider keys server-side.
