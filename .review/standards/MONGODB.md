# MongoDB Standards

## Scope

Apply this profile to application data access, aggregation pipelines, indexes, schema validators, migrations, change-stream consumers, and repository tooling that reads or writes MongoDB.

Use it with `CODING_STANDARDS.md` and the applicable language and runtime profiles. Record the supported MongoDB and driver versions, deployment topology, feature compatibility version, Stable API policy, required concerns, and exact validation commands in `PROJECT_PROFILE.md`.

The checked-in repository contract and real deployment requirements remain the authority. Treat a deviation as a finding only when code or configuration shows a concrete correctness, security, compatibility, reliability, or material performance impact. Label alternative models and speculative tuning as optional improvements.

## Document model and data contracts

- Design collections around real read, write, and atomicity boundaries. Choose embedding or references deliberately; neither normalization nor denormalization is a universal default.
- Prefer embedding when related data is read and updated together and remains bounded. Prefer references when children have independent lifecycles, high cardinality, frequent independent writes, or unbounded growth.
- Keep arrays, nested documents, and individual values bounded. Account for the BSON document-size limit, index-entry growth, network transfer, and application memory before growth becomes a production failure.
- Define field names, BSON types, required and optional fields, `null` versus missing semantics, units, date/time representation, identifiers, and allowed state transitions as contracts.
- Preserve numeric intent across language and BSON boundaries. Review integer range, floating-point precision, `Decimal128`, and driver-specific conversion behavior where exact values or large identifiers matter.
- Store dates as BSON dates when they represent instants. Document UTC, local civil time, date-only values, and timezone identifiers explicitly rather than inferring them from strings or host settings.
- Use collection schema validation for established invariants when practical, while retaining application-boundary validation and useful domain errors. Keep validators, application models, migrations, fixtures, and documentation synchronized.
- When an ODM declares schemas or indexes, compare those declarations with the actual database state and migration path. Auto-indexing in development does not prove that production has the required validator, index options, or build.
- Enforce uniqueness with an appropriate unique index. A pre-insert lookup is not a concurrency-safe uniqueness constraint. Review partial, sparse, and collation semantics against the intended definition of uniqueness.
- For a sharded collection, verify that the required global uniqueness is enforceable. Unique indexes generally require the shard key as a prefix, and `_id` uniqueness is enforced only per shard when `_id` is not the shard key. Use a collision-resistant identifier or redesign the shard key or invariant rather than claiming unsupported cluster-wide enforcement.
- Treat TTL indexes as eventual cleanup, not an exact scheduler, authorization boundary, or proof that data is absent after its expiry time. Enforce time-based validity in reads or application logic when access must stop at a deadline, and assess delete load before creating a TTL index or sharply reducing its duration.
- Give duplicated or derived fields a canonical owner and a repair strategy. Every denormalized copy needs defined update, retry, and stale-read behavior.
- Give polymorphic documents an explicit discriminator and compatibility policy. Readers must handle every schema version they can encounter during deployment and migration.

## Atomicity and concurrency

- Use MongoDB's single-document atomicity as the normal invariant boundary. Prefer one conditional update with update operators over a client-side read-modify-write sequence.
- Put expected state, version, or ownership in the update filter when concurrent modification matters. Check the matched and modified counts; a zero match can be a conflict, absence, or idempotent replay and must not be reported blindly as success.
- Pair upsert predicates with unique indexes when duplicate creation would break an invariant. Account for concurrent upserts and duplicate-key outcomes.
- Do not treat `bulkWrite()` or `insertMany()` as all-or-nothing unless the operations are enclosed in a supported transaction. An ordered batch can leave earlier writes applied before stopping at an error; an unordered batch can continue after individual failures. Inspect per-operation and write-concern outcomes, reconcile applied work, and retry only safe units.
- Use multi-document transactions only for invariants that cannot be modeled as an atomic document operation. Include every dependent operation in the same session, keep the transaction short and bounded, and follow the selected driver's retry contract.
- When one business change spans documents, collections, or external systems and a single transaction cannot cover it, implement it as a durable, idempotent, restartable workflow with explicit step state, compensation or repair behavior, and reconciliation. Do not present a sequence of independent writes as atomic or complete after only the first write succeeds.
- Treat transient transaction errors, write conflicts, and an unknown commit result as distinct states. Retry only at the correct boundary and ensure that application side effects outside MongoDB are idempotent or coordinated.
- Set read concern, write concern, and read preference from the required consistency, durability, latency, and availability contract. Do not weaken acknowledgment or route reads to secondaries without documenting the stale or rollback-visible behavior that callers accept.
- Do not assume `majority` alone provides every ordering guarantee. Use sessions and the appropriate read/write concerns when causal consistency or read-your-own-writes behavior is required.
- Account for automatic driver retries when evaluating duplicate side effects, timeout behavior, and ambiguous outcomes. Do not layer arbitrary retries over non-idempotent operations.
- Change-stream consumers must persist resume progress at the right point, tolerate duplicate delivery, handle invalidated or expired resume positions, and define ordering across partitions or shards rather than assuming one global business-event order.

## Queries, aggregation, and indexes

- Derive indexes from observed or contractually important filter, sort, projection, and update shapes. A proposed performance finding needs workload, scale, execution statistics, or a clear complexity failure.
- For compound indexes, reason about prefix use, equality, sort, range, selectivity, direction, multikey behavior, collation, and covered projections. Treat the ESR guideline as a starting point and validate the actual query.
- Use unique indexes and schema validators for integrity, not only speed. Review index build and rollout order before application code depends on them.
- Inspect representative queries with `explain()` and execution statistics. Compare returned documents with examined documents and keys, check blocking sorts and fetches, and remember that `explain()` does not reproduce normal plan cache behavior exactly.
- Avoid unbounded result sets, projections that fetch large unused fields, client-side joins, N+1 access, and repeated round trips that an appropriate document model or aggregation can eliminate.
- Paginate with a deterministic order and a stable tie-breaker. Large `skip` offsets are not a scalable traversal strategy; prefer range or seek pagination when the access contract permits it.
- Bound `$in` lists, regular expressions, lookup fan-out, grouping state, intermediate documents, and aggregation output. Put selective `$match` and projection stages where the optimizer and semantics allow them to reduce work.
- Do not accept arbitrary field paths, operators, sort specifications, pipeline stages, JavaScript expressions, or update documents from untrusted input.
- Put tenant ownership in every applicable read and write filter, unique-index definition, aggregation, lookup, and bulk operation. An ODM middleware hook is not sufficient evidence if lower-level driver or administrative paths can bypass it.
- Set operation deadlines where indefinite database waits would violate the caller's contract, and propagate cancellation through the driver.
- Account for every index's write amplification, storage, memory, and build cost. Do not add duplicate or speculative indexes solely because a lint rule or one isolated plan suggested them.
- For sharded data, evaluate shard-key cardinality, frequency, monotonicity, targeted query coverage, hot shards, jumbo documents, and cross-shard transactions against the actual growth and access pattern.

## Security and privacy

- Construct queries and updates from an application-owned shape. Whitelist selectable fields and operators; never merge an untrusted object directly into a filter, pipeline, projection, or update document.
- Use authentication, role-based authorization, trusted network boundaries, and TLS. Give application, migration, reporting, and administrative identities only the database and action privileges they require.
- Keep connection strings, certificates, credentials, and encryption keys out of source, logs, errors, examples, fixtures, and process arguments.
- Do not disable certificate or hostname verification to make a connection work. A custom trust store needs a documented deployment reason.
- Minimize sensitive fields and their retention. Review backups, diagnostic output, change streams, analytics copies, and logs as additional disclosure paths.
- Use field-level or queryable encryption only with an explicit query, performance, key-management, rotation, and recovery design. It does not replace access control or transport and storage protections.
- Avoid logging whole filters or documents by default. Preserve an operation or correlation identifier and safe structural context instead.

## Migrations and compatibility

- Treat stored documents and index definitions as public compatibility contracts between old and new application versions, jobs, and services.
- Prefer expand-migrate-contract changes: deploy tolerant readers, add new writes or dual writes when justified, backfill, verify, enforce validators or indexes, stop old writes, and remove compatibility code only after old data and binaries are gone.
- Make data migrations deterministic, restartable, observable, and safe to rerun. Verify explicit preconditions before the first write and postconditions before declaring success. Use bounded batches, durably recorded checkpoints after committed work, explicit conflict behavior, and post-migration reconciliation rather than one unbounded transaction or scan.
- Preserve fields unknown to an older writer when rolling compatibility requires it. Full-document replacements can silently erase fields introduced by a newer version.
- Separate index creation, data backfill, validator tightening, and destructive cleanup when their lock, resource, or rollback profiles differ.
- Test mixed-schema collections and rolling application versions. A successful migration on a clean fixture does not prove compatibility with real historical shapes.
- Check driver, server, topology, feature compatibility version, command, and index-feature requirements before adoption. Use the Stable API only for the guarantees it actually covers.
- Define rollback before destructive transformations. Backups are not a rollback plan until restoration and reconciliation have been exercised.

## Driver lifecycle and code-visible operations

- Reuse the driver's intended long-lived client and connection pool. Avoid a new client per request, and close owned clients during orderly shutdown and tests.
- Configure server selection, connection, socket, and operation timeouts from the service's latency budget. Avoid both indefinite waits and one blanket timeout with no relation to the operation.
- Bound pool size, wait queues, concurrency, cursors, and batch sizes. Close or exhaust cursors when the driver requires it and do not buffer unbounded results.
- Define startup and degraded behavior when no suitable server is available. Readiness should reflect whether required database work can succeed, without making health checks expensive or state-changing.
- Surface enough context to distinguish validation, duplicate-key, timeout, selection, write-conflict, authentication, and topology failures without leaking data.

## Tests and validation

- Use the repository's configured driver and test tooling as the authority.
- Exercise integration behavior against a real MongoDB deployment that represents the claimed topology. A mock cannot prove BSON conversion, index, concern, transaction, change-stream, or server-version behavior.
- Test schema validation, uniqueness, missing versus `null`, numeric and date boundaries, duplicate retries, concurrent updates, upserts, pagination, and cancellation where applicable.
- Run transaction and change-stream tests on a supported replica set or sharded topology. Do not treat standalone-only tests as coverage for those contracts.
- Test migrations from representative historical fixtures, interruption and resume, repeated execution, mixed application versions, and reconciliation.
- Capture representative execution statistics for contractually important or known-hot queries. Avoid brittle assertions on undocumented plan formatting; assert the material access characteristic or budget.
- Isolate databases or collection namespaces per test worker. Do not depend on execution order, shared developer data, sleeps, or hidden network services.
- Run the exact focused tests, migration checks, schema validation, and smoke commands named in `PROJECT_PROFILE.md`; report commands, versions, topology, and outcomes exactly.

## Primary references

- [MongoDB data modeling: embedding versus references](https://www.mongodb.com/docs/manual/data-modeling/concepts/embedding-vs-references/)
- [MongoDB schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/)
- [MongoDB bulk write operations](https://www.mongodb.com/docs/manual/core/bulk-write-operations/)
- [MongoDB shard-key index restrictions](https://www.mongodb.com/docs/manual/core/sharding-shard-key-indexes/)
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
- [MongoDB read concern](https://www.mongodb.com/docs/manual/reference/read-concern/)
- [MongoDB write concern](https://www.mongodb.com/docs/manual/reference/write-concern/)
- [MongoDB transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)
- [MongoDB indexes](https://www.mongodb.com/docs/manual/indexes/)
- [MongoDB ESR guideline](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
- [MongoDB query plans](https://www.mongodb.com/docs/manual/core/query-plans/)
- [MongoDB Stable API](https://www.mongodb.com/docs/manual/reference/stable-api/)
- [MongoDB security checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)
