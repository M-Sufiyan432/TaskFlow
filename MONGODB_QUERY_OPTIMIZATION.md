# MongoDB query optimization

## Indexed access paths

Tasks now have compound indexes for the dominant tenant-scoped reads: `(club, isArchived, status, createdAt, _id)`, `(club, isArchived, position, _id)`, `(club, isArchived, dueDate, _id)`, `(assignedTo, isArchived, dueDate, _id)`, and `(club, isArchived, priority, createdAt, _id)`. Notifications add `(recipient, isRead, createdAt, _id)` and `(recipient, type, createdAt, _id)`. Each ends with `_id` to provide a deterministic keyset-pagination tie-breaker.

Compound indexes are intentionally narrow. Every index improves a read but adds storage, RAM pressure, and write amplification for task updates. Monitor `explain('executionStats')`, production slow-query logs, index size, and write latency before adding variants for every optional filter. Avoid compound indexes with more than one array field; MongoDB rejects or poorly serves many multikey combinations.

## Query changes

Task list views project only list-card fields, run list and count in parallel, cap page sizes at 100, and preserve access-control conditions when a search filter is added. Previously, a search could replace an existing `$or` access condition; search is now added as an `$and` clause. Embedded comments remain suitable for per-task detail views, but they are a growth bottleneck: an unbounded comments array inflates every task document and cannot be independently paginated. Move comments into their own collection with `(task, createdAt, _id)` when high-volume discussion is expected.

The club overview collapses three task count queries into one `$match + $group` aggregation, allowing the tenant/archived index to narrow the working set once. Task analytics already uses `$match` before `$facet`, which is the correct order. Use `allowDiskUse` only after observing aggregation memory pressure; it trades latency for avoiding memory errors.

## Pagination and tenants

Task feeds sorted by `createdAt` expose a `createdAt_objectId` cursor and return `pageInfo.nextCursor`; this avoids `skip` degradation on deep pages. Legacy page/limit behavior remains for other sort orders. Notifications opt into cursor mode with the `cursor` parameter (use an empty initial value) and receive the same cursor shape.

ClubFlow is tenant-scoped by `club`. Put `club` first in tenant query indexes and enforce it in every repository/controller query before user-level clauses. At larger scale, route/partition by club only after operational evidence shows a single cluster cannot meet latency or storage goals. Aggregates and cache invalidations should remain tenant-local; never run unbounded cross-club reporting on the interactive path.
