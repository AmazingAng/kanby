# Human–Agent interaction collection

Use CLI 0.5.0+ and a server with migration 0016. Session commands are independent
of task claims and completion. `kanby auth status --json` identifies the one
project selected by the credential; do not infer another project from a folder
name. Each member needs their own Agent Token. A shared token cannot attribute
its users separately.

## Record the entire selected-project conversation

Record project work even when no card exists: planning, questions, coding,
review, testing, progress discussions and handoff. Do not create a card merely
for telemetry. This applies only while this skill is active in an explicitly
selected project; it cannot collect other clients or discover missing activity.

1. Start once per conversation/work session. `--task` is optional. Retain the
   returned session ID in conversation context (including compaction summaries)
   or `KANBY_SESSION_ID`; never reuse one ID for different concurrent sessions.
2. For every actual incoming user turn, record `prompt`, without copying the
   user's message. If this turn answers an open wait, record `reply` with that
   wait's request ID instead. A status question does not necessarily answer an
   outstanding approval request: keep that wait open and use `prompt`.
3. Record meaningful Agent milestones with `note`; before yielding because an
   answer, review, approval or acceptance is needed, use `wait` with the correct
   reason. A progress commentary while execution continues is not a wait.
4. When a matching response arrives, record its actual decision: `continue`,
   `changes`, `accept`, or `defer`. This is Agent-reported evidence, not verified
   human review. Never infer acceptance from silence, elapsed time, a heartbeat,
   a PR merge, or the fact that the user opened a page. Only use `accept` when
   the user actually accepted the requested outcome. Deferral pauses the session.
5. Resume an explicitly paused session with `resume`. For work continuing without
   an open wait, the next user message is a `prompt`. Do not repeatedly end/start
   sessions at every turn, which would erase the handoff wait.
6. End when the session is explicitly finished or cancelled. Keep an acceptance
   wait open when the user has yet to respond. Ending with an unresolved wait
   counts as cancellation of that wait, never a successful response. Session
   outcome `completed` does not mark its task shipped; human card acceptance
   remains a separate action.

```bash
kanby session start --client codex --context "xAPI project work" --json
# Optional task association at start: --task KANBY-100
kanby session prompt <session-id> --json
kanby session note <session-id> --summary "Local checks passed" --json
kanby session wait <session-id> --reason review --json
# Retain wait.id from the result. After the corresponding real user response:
kanby session reply <session-id> --request <wait-id> --decision changes --json
kanby session end <session-id> --outcome handed-off --json
```

`--reason`: `input`, `review`, `approval`, `acceptance`.
`--outcome`: `completed`, `handed-off`, `cancelled`, `failed`.
All event commands accept optional `--summary` (one line, at most 500 characters),
`--event-id <uuid>`, and `--revision <number>`. Summaries are opt-in: do not upload
raw prompts, transcripts, command output, credentials or private local paths.

## Reliability and lifecycle integration

`kanby session get <id> --json` returns the revision and open wait. Normal event
commands fetch the current revision automatically, but a race returns 409. On
an ambiguous failure, retry the identical command with the event ID and revision
printed in its error; on a definite conflict, re-read and resolve the actual
state before constructing a new event. Start accepts `--id <uuid>` for safe
retries. Errors are visible and nonzero; failed submissions are collection gaps,
not silently backfilled events. There is no offline spool in this version.

Send `session heartbeat <id>` at meaningful liveness checkpoints during long
work; this does not prove human presence. More than five minutes without any
received session event is displayed as stale/unknown, never automatically ended.
A waiting session still shows how long its open request has waited.

For an Agent executable, the CLI can supervise its lifetime:

```bash
kanby session run --client my-agent --task KANBY-100 -- my-agent <arguments>
```

This starts a session, exports `KANBY_SESSION_ID` to the child, sends a heartbeat
every minute, forwards terminal I/O and preserves child exit status (telemetry
failure changes a successful exit to failure). It never parses or uploads child
I/O. A successful process still running in Kanby becomes waiting for acceptance;
existing waits, pauses and ends are preserved. Abnormal process exit ends failed
or cancelled; killing the supervisor leaves an unknown/stale session.

Client lifecycle integrations can call the same commands for actual prompt and
handoff events. Do not advertise a provider-specific hook adapter as installed:
this release supplies a protocol, supervisor and skill guidance only. A desktop
Agent that cannot be launched by the wrapper uses the skill commands directly.
Neither mode can promise 100% capture of omitted calls or uninstrumented clients.

## Read and review

```bash
kanby session list --json
kanby session list --member <member-id> --task KANBY-100 --json
kanby session events <session-id> --limit 50 --json
kanby session events <session-id> --cursor <nextCursor> --json
kanby session report --from 2026-09-24 --to 2026-09-30 --timezone Asia/Shanghai --json
```

List/history pages have at most 50 entries; follow `nextCursor` until null.
Reports read at most 10,000 events and fail with 422 above that bound rather than
return partial statistics. They include sessions overlapping the requested
inclusive calendar-date period. Response samples are wait/reply pairs whose
reply was received in the period; waits may have started earlier. Pending waits
at cutoff, cancelled waits and stale sessions are separate counts. Percentiles
use nearest rank and report sample sizes; no samples gives null, not zero.

All CLI prompt/reply events are `agent_reported`, attributed to the authenticated
Token owner. `/api/sessions` accepts same-origin cookie-authenticated member
replies as `verified_user`; this means a logged-in member submitted a response,
not that the quality or depth of review was proven. A token cannot assert this
provenance or act as another member. Reports group latency by the session owner,
with the actual responding actor retained in event history.

The migration records when collection became available. Coverage always states
`instrumented_sessions_only` with `complete: false`: uninstrumented clients and
failed submissions are unknown. Zero observed sessions is not zero work. Times
are server receipt times and include nights/weekends; delayed reporting and
missing events can distort them. Do not rank members using prompt counts,
heartbeat counts or response time alone. Existing task delivery reports remain
unchanged and should be read alongside interaction evidence.
