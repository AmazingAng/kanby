# Kanby CLI + Codex Skill

Use Kanby from a terminal, CI job, or coding agent. The public repository ships both the zero-dependency Node.js CLI and the Kanby Codex skill.

## Install the CLI

```bash
npm install -g github:AmazingAng/kanby-cli#v0.2.0
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
npx skills add https://github.com/AmazingAng/kanby-cli --skill kanby
```

The skill guides coding agents through listing work, claiming a task, reporting meaningful progress, associating a GitHub PR, and completing or releasing the task safely.

## Quick start

```bash
kanby task list
kanby task claim <ref> --lease 15
kanby task get <ref>
kanby task checklist add <ref> "Tests pass"
kanby task checklist check <ref> 1
kanby task progress <ref> "Implemented the first working slice"
kanby task complete <ref> --message "Tests pass and PR is ready"
```

Task mutations support `--idempotency-key <stable-key>` for safe retries. Never commit or print an Agent Token.

## Requirements

- Node.js 20 or newer
- A Kanby project Agent Token

## License

MIT
