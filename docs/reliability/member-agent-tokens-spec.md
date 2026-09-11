# SPEC — Member-owned Agent Tokens

- Tier: 3 — authenticated credential issuance, ownership authorization, revocation, abuse limits, and Agent API authentication
- Spec approval: not obtained (autonomous run requested by the user); EVIDENCE must record the confidence downgrade
- Setup plan:
  - Tools to install: none
  - Git isolation: continue on the existing `codex/fix-kanby-reliability` working branch because the active Kanby application is intentionally uncommitted/untracked and would be absent from a new worktree
  - Existing gauntlet: reuse `tools/gauntlet.sh`, `tools/mutants.mjs`, `tools/check-secrets.mjs`, and `tools/source-state.mjs`
  - Files added: `tests/agent-token-self-service.test.ts` and `docs/reliability/member-agent-tokens-evidence.md`
  - Files updated: `app/api/agent-tokens/route.ts`, `lib/agent.ts`, `components/settings-app.tsx`, `docs/AGENT_API.md`, and `tools/mutants.mjs`
  - New dependencies: none

## Failure model

- A project member could create a token attributed to another user: derive the identity and `githubLogin_tokenName` label exclusively from the authenticated session.
- A member could list or revoke another member's token: scope member lists by `user_id` and include the actor predicate in the revocation SQL statement; retain project-owner administration.
- A removed member could keep using a previously issued token: Agent authentication must require a current project-membership row.
- Self-service issuance could create unbounded credentials: atomically cap active, unexpired tokens at 10 per user and project.
- Token plaintext could leak through listing or logs: return it only in the successful creation response and continue storing only its SHA-256 digest and short prefix.
- Existing owners and Agents could break: retain existing token `name`, scopes, wire envelope, authentication format, and owner-wide visibility/revocation.

## Scenarios

1. **Member creates an attributed token**
   - Given Bob is a current member, when Bob creates token name `codex`, the response is HTTP 201, returns plaintext once, stores Bob's user ID, and exposes the server-derived label `bob_codex`.

2. **Client cannot spoof the token owner label**
   - Given Bob is authenticated, when the request also sends a fake username, the stored and returned label remains `bob_<tokenName>`.

3. **Member sees only personal tokens**
   - Given Alice and Bob have tokens in the same project, Bob's GET returns only Bob's tokens while project-owner Alice's GET returns both, labeled with their GitHub logins.

4. **Revocation follows ownership**
   - Bob can revoke Bob's token, cannot revoke Alice's token, and Alice as project owner can revoke Bob's token. A denied request does not change the target token.

5. **Non-members cannot manage tokens**
   - A signed-in user outside the project receives HTTP 403 for list, create, and revoke operations.

6. **Removed-member tokens stop authenticating**
   - A token authenticates while its issuing user is a member and returns HTTP 401 immediately after that membership row is removed.

7. **Issuance is bounded atomically**
   - Concurrent creation attempts cannot produce more than 10 active, unexpired tokens for one user and project; excess requests return HTTP 409 without plaintext tokens.

8. **Hostile token names are rejected**
   - Empty names, names over 48 characters, and control-character names return HTTP 400 and create no rows; Unicode display names without controls remain valid.

9. **Settings exposes self-service clearly**
   - Both owner and member roles see the creation form, a live `githubLogin_tokenName` preview, and revoke controls only for records the server marks manageable.

## Must NOT

- Never return `token_hash`, another token's plaintext, session secrets, or full token values from list/revoke responses.
- Do not let a member infer or mutate another member's token through ID guessing.
- Do not remove owner-wide token administration.
- Do not weaken current membership checks, same-origin mutation checks, expiry checks, scope checks, constant-time hash comparison, or one-time plaintext display.
- Do not add a migration, dependency, browser storage, or credential to the source tree.

## Revisions

- Initial autonomous specification.
- Property testing found that checking controls after `trim()` accepted leading/trailing tabs and newlines. The implementation must inspect the raw input for controls before whitespace normalization; scenario 8 remains unchanged and now covers controls at every generated position.
