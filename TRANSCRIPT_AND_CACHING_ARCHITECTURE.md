# Transcript extraction and Redis caching

## NLP workflow

The transcript API stores the source transcript separately from the proposed tasks, then sends a compact request to an asynchronous AI worker. The worker uses strict structured output, filters malformed results, restricts assignees to known club members, and discards items under the configured confidence threshold (default `0.45`). Each proposed task carries evidence and a `0..1` confidence value so a reviewer can quickly distinguish a clear commitment from ambiguous discussion.

The proposal moves through `queued -> processing -> ready_for_approval -> approved` (or `failed`). An authorized task creator selects task IDs to approve; only those selections become real `Task` records. This human-in-the-loop boundary prevents a model hallucination or a weakly implied discussion point from silently creating work.

Endpoints: `POST /api/ai/transcript-extractions`, `GET /api/ai/transcript-extractions/:jobId`, and `POST /api/ai/transcript-extractions/:jobId/approve`. Requests are queued because model calls have variable latency, need retries and rate limits, and should not hold an API request or database transaction open. Inputs have a 50,000-character limit and task outputs are capped at 30 to control token spend.

## Cache design

Redis keys are namespaced and versioned (`clubflow:cache:v1`) and cache dashboard data per user, plus overview, task analytics, task counts, and club detail per club. Responses include `X-Cache: HIT` or `MISS`. Reads fail open: a Redis outage falls back to MongoDB rather than breaking ClubFlow.

TTLs are intentionally short: 30 seconds for dashboard/counts, 60 seconds for analytics/overview, and 120 seconds for club detail. Write paths additionally invalidate related keys immediately: task create/update/delete/status/assignment clears club aggregates and dashboards for the creator/assignees; club edits clear club cache entries. This is a practical cache-aside strategy: explicit invalidation gives fast convergence, while TTLs bound any stale data if an invalidation fails.

For future scale, move invalidations to a transactional outbox or domain-event consumer so updates originating outside HTTP controllers also publish cache invalidation events. Do not cache authorization-dependent payloads under a shared club key unless access checks run before cache lookup and the response is identical for every authorized caller.
