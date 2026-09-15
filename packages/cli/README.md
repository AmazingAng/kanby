# Kanby CLI + Codex Skill

Use Kanby from a terminal, CI job, or coding agent. The CLI and Kanby coding-agent skill are maintained in the Kanby monorepo so application API changes, CLI behavior, and integration tests ship together.

## Install the CLI

From a Kanby repository checkout:

```bash
npm install
npm install --global ./packages/cli
```

Create a project Agent Token in **Kanby → Settings → CLI 与 Coding Agent**. For agents and CI, expose it through the environment:

```bash
export KANBY_TOKEN="kby_..."
kanby auth status
```

`KANBY_URL` is optional and defaults to `https://kanby.0xaa.workers.dev`. Run `kanby --help` for all commands and add `--json` for machine-readable output.

To store a validated token in the local CLI config instead, run `kanby auth login --token "$KANBY_TOKEN"`. Kanby writes the config with user-only permissions.

## Install the skill

```bash
npx skills add https://github.com/AmazingAng/kanby --skill kanby
```

The skill guides coding agents through listing work, claiming a task, reporting meaningful progress, associating a GitHub PR, and completing or releasing the task safely.

## Create a card with a deadline

With CLI 0.3.0+ and a server supporting deadline creation:

```bash
kanby task create "Release v1" --due 2026-09-30 --note "Agreed release scope" --json
```

Deadlines use `YYYY-MM-DD` with no timezone conversion. Omit `--due` when none is requested. Use the returned task reference to inspect or change it:

```bash
kanby task get <ref> --json
kanby task update <ref> --due 2026-10-02 --json
kanby task update <ref> --due "" --json
```

The final command explicitly clears the deadline. If an older server omits `due` from the creation result, update that same task with `task update --due` instead of creating another card.

## Verify the checklist before completing

```bash
kanby task list --json
kanby task claim <ref> --lease 15 --json
kanby task get <ref> --json
kanby task checklist add <ref> "Tests pass" --json
kanby task checklist <ref> --json
```

Run the required tests first. Only after they pass, use the corresponding checklist item ID:

```bash
kanby task progress <ref> "Required tests passed" --json
kanby task checklist check <ref> <item-id> --json
kanby task checklist <ref> --json
kanby task complete <ref> --message "All acceptance criteria verified; tests pass" --json
```

Repeat validation and `check` for each criterion, then re-read the list before completing. Item numbers (starting at 1) are supported, but stable IDs avoid selecting a different item after concurrent reordering. `complete` updates the task status; it does not check any checklist items or verify their evidence. Leave unverified work open.

Archive only when requested, using `kanby task archive <ref>`.

Task tags are `产品`, `设计`, `代码`, or `增长`. Archiving is recoverable from
the Kanby archive; permanent deletion is intentionally unavailable to Agent
Tokens.

Task mutations support `--idempotency-key <stable-key>` for safe retries. Never commit or print an Agent Token.

## Requirements

- Node.js 20 or newer
- A Kanby project Agent Token

## License

MIT
