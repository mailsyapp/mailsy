# Composer surface parity

## The invariant

A feature that adds behavior to a composer must land on **all three composer surfaces at once**, or it is incomplete:

1. **New compose** — the toolbar `Compose` entry point (`ComposeEditor`).
2. **Draft editor** — reopening a stored draft (`DraftEditor`).
3. **Reply / forward** — the composer inside the conversation view (`EmailDetail`).

The surfaces are "everywhere a message is written", and they share state shape: a composer change is message content (body, recipients, threading, attachments), never a UI-local extra. The rule keeps them from drifting: a working new-compose and a silently missing draft editor is a bug shipped to users, not a follow-up.

## How the codebase routes it

The three forms render different shells but are meant to share *everything below the shell*: one hook owns composer state (`useComposerAttachments` for files, `useDraftAutosave` for persistence), one shared field component per field kind (`RecipientFields`), one shared content unit, one boundary shape in `src/shared/types.ts`. If you find yourself changing `ComposeEditor.tsx` and `DraftEditor.tsx` with near-identical lines but not the third copy, the change should move into a shared hook or component instead of being duplicated onto more forms.

The catch you will not see from the diff: attachment-like content rides `drafts.update`, which **replaces the raw message wholesale** — so anything the draft carries must be re-sent on every autosave payload, or an edit silently strips it. Anything that adds a field to `SendEmailRequest` has the same blast radius.

## Enforcing it (what the agent must actually do)

1. **Change the three surfaces together** — one commit or PR, not "follow-up"s that spot-check only the surface the ticket mentions.
2. **Run the harness against the boundary and the surfaces**, not just typecheck:
   - `npm run typecheck && npx eslint src` — clean.
   - The MIME/boundary node harness when shared shapes or main-process code changed: `node --experimental-strip-types .agents/harness/mime-attachments.ts`.
   - The scripted journeys with the server running per `verify-mailsy/SKILL.md`; for composer work the minimum set is `attachments`, `compose-new`, `compose-send`, `draft-autosave`, `cc-bcc` — plus `drafts`/`delete-draft` if drafts were touched. All must end `RESULT pass`; a composer feature whose own journey does not cover every surface goes into `.agents/skills/verify-mailsy/features/` with a journey step **per surface** in the same change.
   - The Electron shell itself (native dialogs, real Gmail send) stays the documented manual tier.
3. **Update the harness in the same change.** A new composer behavior with no scripted step, or a mixed-surface journey, is how the parity rule decays. The mock must gain whatever verb the real boundary gained, and the journey must drive every surface the change claims to cover.
