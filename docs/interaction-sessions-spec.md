# Project and task interaction sessions

Tier 3: public API, authenticated attribution, concurrent event ingestion.
Spec approval: not obtained (autonomous run under the user's implementation and
merge instructions). This is the reviewable contract, not independent approval.

## Setup

Use branch `codex/interaction-sessions` from the clean main checkout. No new
packages or tools. Reuse SQLite/D1, Vitest, fast-check, coverage and the existing
`tools/gauntlet.sh` and `tools/mutants.mjs`. Add tests in
`tests/interaction-sessions.test.ts` and `tests/interaction-cli.test.ts`, plus
`docs/interaction-sessions-evidence.md`. Add an explicit session coverage layer
to the gauntlet. Commit specification, implementation and evidence separately;
fetch, run required checks, merge and push without bypassing protections.

## Scope and scenarios

1. A member starts multiple independent sessions in their token's project,
   with an optional existing task reference. Project-only work does not create
   a task. Start/end never change task status or task claims.
2. Token identity supplies project and member attribution. Foreign projects,
   foreign tasks and another member's writes are rejected. Other active members
   may read project session history. Revoked tokens and missing scopes fail.
3. Events record start, user prompt (reported), Agent progress/note, heartbeat,
   waiting for input/review/approval/acceptance, a correlated human reply,
   pause/resume and explicit end. Every command uses a stable session/event ID
   and expected revision. Conflicting/reordered writes return 409; identical
   retries do not duplicate events, even concurrently or after a later event.
4. Agent Token events are always labelled agent-reported, including claimed
   human prompts/replies. Only a same-origin authenticated member response via
   the browser API is verified-user. Body fields cannot forge that provenance.
   A reply references the specific open wait; stale replies cannot close a new
   wait. Viewing a page or sending a heartbeat is not a human response.
5. Server receipt time is authoritative. No heartbeat for five minutes marks
   running sessions stale/unknown, never normally ended or abandoned. Waiting
   duration is displayed independently of liveness. End preserves unresolved
   waits as cancelled, not answered. Pausing and deferring remain explicit.
6. List and event history are bounded and cursor-paginated. A period report
   returns per-member observed sessions, pending waits, stale sessions and
   response-time P50/P90 with sample counts split by provenance. Unanswered
   waits are shown separately; they are not zero-duration responses. Zero
   observed sessions is not zero work. Calendrical time is not labor time.
   Reports fail visibly on capacity limits rather than truncating statistics.
7. Real CLI commands support start/get/list/events, prompt/note/wait/reply,
   heartbeat/pause/resume/end and report. IDs can come from explicit flags or
   environment context, allowing every turn in a coding-agent conversation to
   join one session. Validation/network failures have nonzero exits. A wrapper
   can start a process and report its lifetime, without parsing its stdin/stdout
   as verified human interaction. Unexpected termination leaves stale status.
8. Skill guidance covers every user turn and Agent handoff inside an explicitly
   selected project, whether or not a card exists. It never claims global
   capture of uninstrumented clients. No raw transcripts, tool output, secrets,
   private filesystem paths or prompt text are uploaded by default. Summaries
   are explicit and optional. No silent credential or project selection.
9. Migration is additive, leaves existing records intact, and records the
   collection start. A transaction rollback rehearsal restores existing data.
   Existing CLI/API behavior and the prior full gauntlet remain compatible.

## Failure model and evidence

- Identity spoofing / cross-project reads: adversarial route/store tests.
- Duplicate, racing or stale state: real SQLite concurrent requests and replay
  tests; mutation of ownership/revision/correlation guards.
- Partial state/event write: transactional fault injection / rollback checks.
- Missing telemetry mistaken for inactivity: stale/provenance/coverage tests.
- Inflated metrics: repeated waits/replies, pending/cancelled samples, percentile
  and ordering tests, including property-based nonnegative delay invariants.
- Malformed input / huge queries: bounded JSON, identifiers, pagination and
  capacity rejection tests; no reflected secrets in error messages.
- Packaging/integration: real CLI subprocess against local HTTP route handlers,
  pack check and Worker build; skill validation.

## Limits

This is an opt-in protocol plus CLI/skill instrumentation, not an OS-wide
monitor. Skill calls can be missed. Wrapper lifetime cannot prove model work,
review quality or human attention. Offline events are not silently backfilled;
failed calls must be surfaced and retried with the same IDs. Calendar reports
include nights/weekends; business-hours/leave calendars and provider-specific
hook adapters are separate integration work. No production deployment or npm
publication is implied by a source merge; report release status explicitly.

## Revisions

- Initial contract: project-wide instrumentation with optional task association,
  honest provenance and collection coverage, and unchanged delivery metrics.
