# Markdown descriptions and Agent checklist operations

Status: implementation spec (autonomously authored; no separate approval)
Risk tier: 3 — public Agent API/CLI, concurrent task mutation, and one controlled production-data repair

## Goal

Kanby renders task descriptions as safe GitHub-flavoured Markdown in the card and task detail views. Cards show only a compact excerpt. Agents can list, create, edit, check, uncheck, and remove structured acceptance criteria through the API and CLI, and the Kanby skill tells agents not to place acceptance criteria in the description.

## Setup and planned files

- Add exact runtime dependencies `react-markdown@10.1.0` and `remark-gfm@4.0.1`.
- Add a shared Markdown renderer and integrate it into `components/kanban-app.tsx`.
- Extend `app/api/v1/tasks/route.ts` and the acceptance-criterion activity actor in `lib/db.ts`.
- Extend `packages/cli/bin/kanby.js`, bump the CLI package to `0.2.0`, and update CLI documentation.
- Update `skills/kanby/SKILL.md` and `skills/kanby/references/cli.md`, then validate the skill package.
- Add API, CLI, Markdown safety, and mutation tests. No database migration is required.
- After deployment, repair only the production card titled `部署正式服务测试`: create its seven existing Markdown checklist lines as structured acceptance criteria, then remove only the `## 验收标准` section from its description.

## Executable scenarios

1. Markdown detail preview renders headings, lists, links, inline/fenced code, blockquotes, tables, and GFM task-list syntax. Raw HTML is not rendered and unsafe link protocols are not emitted. Links opened in a new tab include safe `rel` attributes.
2. The card uses the same Markdown semantics but its description region has a strict compact height and clips overflow, so a long description cannot grow the card indefinitely.
3. The detail view opens in preview mode, can switch to editing, keeps the existing auto-save behaviour, and explicitly directs users to the structured checklist for acceptance conditions.
4. `kanby task checklist <ref>` lists numbered structured criteria. `add`, `edit`, `check`, `uncheck`, and `remove` send the corresponding checklist action to the Agent API.
5. A checklist item reference is either a one-based displayed number or an unambiguous item ID/prefix; zero, out-of-range, missing, foreign, and ambiguous references fail without mutation.
6. Agent checklist mutations are project-scoped, obey another Agent's active claim, use optimistic task/item revisions, respect 20-item and 240-character limits, and participate in existing idempotency handling.
7. Checklist activity events use source `agent` and the Agent token identity rather than appearing as browser-user edits.
8. The Kanby skill directs agents to store acceptance conditions with checklist commands, inspect them before completion, and check an item only when evidence supports it.
9. The named production card retains every non-acceptance section of its description and all other fields; exactly seven structured criteria are created, the obsolete Markdown acceptance section is removed, and the claim is released after verification.

## Failure modes and invariants

- Never enable raw HTML or allow `javascript:`/unsafe URLs through rendered Markdown.
- Never render the full unbounded description in a card thumbnail.
- Never translate a CLI checklist write into `note` text.
- Never accept more than 20 items, an empty item, or an item longer than 240 characters.
- Never mutate a criterion outside the resolved task/project or bypass an active claim.
- Never leak an Agent token through source, logs, command arguments, test output, or release artifacts.
- Never alter another production task, auto-complete the repaired card, or fabricate checked states; migrated criteria remain unchecked.
- Idempotent retries produce one logical mutation, and stale concurrent writes return a conflict instead of overwriting newer data.

## Evidence required

- RED tests fail for missing Markdown safety/compact rendering and missing CLI/API checklist operations.
- GREEN targeted tests, type-check, lint, full test suite, production build, coverage, and mutation gauntlet pass.
- Deployment smoke tests confirm the public site/API.
- A final read-back confirms the repaired production task has seven structured criteria and no `## 验收标准` description section.
