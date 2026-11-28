# Mini program UI refresh

KANBY-145, 2026-11-28. The user's phone now reaches the queue and task details,
but the original layout wastes vertical space, uses oversized card typography,
constrains acceptance criteria inside native default buttons, and prints null
activity bodies.

The native UI now uses Kanby's cream, charcoal and lime palette and existing
avatar asset. A compact workspace picker and account menu replace the repeated
brand/account header. Queue cards show the turn reason, task reference and a
two-line summary. Details put the handoff before the description, support
expanding long descriptions, use full-width checklist rows and show completion
counts. The acceptance button remains gated by task state and now also reflects
incomplete criteria. Existing server authorization, revision checks and final
confirmation remain authoritative. Comments precede the timeline; activity has
timestamps and expandable long bodies, and null/empty bodies are omitted.

## Validation

- The new null-body regression failed against the unconditional old element;
  it passes against the conditional new element. Existing login and pairing
  assertions use stable region IDs instead of presentation class names.
- `npm run gauntlet`: 19/19 layers passed, 325 tests across 45 files,
  116/116 mutations killed, existing coverage gates, TypeScript, lint,
  formatting, secret scan, shuffled tests and Worker build/schedule checks.
  Production dependency audit reported zero vulnerabilities. The first sandboxed
  attempt could not bind test HTTP servers; the complete successful run allowed
  local listening.
- Chrome visual inspection used a temporary HTML projection of the actual WXML
  and WXSS at 390px content width with representative queue, detail and login
  fixtures. Checklist rows, truncated summaries and the body-less timeline
  looked correct. This is a layout approximation, not WeChat native rendering
  or a substitute for on-device interaction acceptance.
- Official miniprogram-ci 2.1.31 compiled/uploaded development version 0.1.2
  successfully; upload archive size was 963,351 bytes. Official preview also
  succeeded. Private receipts and the QR are under ignored
  `outputs/mini-ui-20261128/`; no key or secret is included in the package.

No backend, authentication, database or domain change is needed. Existing
account binding is retained. This is a development/preview upload, not a reviewed
public mini-program release. Native phone appearance and remaining comment and
acceptance interactions still need user verification; KANBY-145 stays open.
