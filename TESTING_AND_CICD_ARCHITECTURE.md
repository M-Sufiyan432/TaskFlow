# Testing and CI/CD architecture

## Test layers

The Jest configuration separates fast unit tests from HTTP integration tests. Unit tests mock MongoDB models, Redis/BullMQ producers, and external services to verify RBAC decisions, task state transitions, and queue payload contracts in milliseconds. Supertest integration tests mount real Express routers and controllers but replace persistence/external boundaries with deterministic mocks; this catches route wiring, serialization, validation, and auth-context mistakes without requiring a local database.

Full integration tests should run against an isolated MongoDB database provisioned by CI and real Redis when testing worker behavior, migrations, indexes, and serialization contracts. End-to-end tests are a smaller browser/API smoke suite against a deployed staging environment; they validate the complete client, API, authentication, queue, and infrastructure path. Keep E2E coverage focused on critical journeys because it is the slowest and least deterministic layer.

Mock only infrastructure boundaries, not business logic. Reset mocks after every test, use stable fixture IDs, and test negative authorization paths alongside successful actions. CI reports coverage from the exercised modules; introduce per-module thresholds as meaningful suites are added rather than setting a blanket repository percentage that would reward shallow tests.

## Pipeline and deployment

`ci.yml` installs from lockfiles, syntax-checks backend JavaScript, runs Jest coverage, builds the frontend, and runs production dependency audits. A main-branch deployment can run only after every quality gate passes. It targets the GitHub `production` environment, where required reviewers and environment-scoped secrets should be configured in GitHub settings.

Deployment is webhook-based and passes the exact commit SHA, so the deployment provider should create an immutable release, run health checks, and promote only that artifact. Store `DEPLOY_WEBHOOK_URL` and `ROLLBACK_WEBHOOK_URL` as environment secrets; never place provider tokens in workflow files. The separate manual rollback workflow activates a named previously healthy release. Rollbacks should be backward-compatible with database changes: use expand/migrate/contract migrations, feature flags, and delayed destructive schema cleanup.
