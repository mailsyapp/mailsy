# Rich text

Every composer body carries a Gmail-style formatting toolbar: bold, italic, underline, link, numbered list, bulleted list, quote, and remove formatting. The toolbar and its commands live once in `ComposerBody` → `FormattingToolbar` + `BodyEditor` (DOM logic in `src/renderer/src/lib/richText.ts`), so a fresh compose, an opened draft, and the reply/forward composer behave identically. Formatting is ordinary body html: it rides the draft autosave and the send's `bodyHtml` with the plain-text fallback beside it, and a reopened draft reads it back.

## Sub-features

- `inline-formats` Bold (`Ctrl+B`), Italic (`Ctrl+I`), Underline (`Ctrl+U`) toggle at the caret or over a selection; the buttons' `aria-pressed` mirrors the caret's formatting.
- `link` the `Link` button or `Ctrl+K` opens the `Edit link` group (`Text to display`, `Web address`, `Apply link`/`Cancel link`, and `Remove link` when the caret is on a link). Bare domains get `https://`, bare emails `mailto:`; any other scheme (`javascript:`, `data:`, …) is refused with the inline error "Enter a valid web address or email."
- `lists` `Numbered list` (`Ctrl+Shift+7`) and `Bulleted list` (`Ctrl+Shift+8`); Enter adds an item, Enter on an empty item leaves the list.
- `quote` `Quote` (`Ctrl+Shift+9`) wraps the line in a Gmail-styled `<blockquote>`, and toggles it off again. A reply/forward's own `.gmail_quote_container` quote is not a user quote: the button stays unpressed inside it and never unwraps it. Quote and both list commands are no-ops while the selection touches that native quote. Block commands clamp a selection that reaches the signature so `.mailsy-signature` stays a direct child of the body, and put a line break before a list/quote that would otherwise merge with the inline line above it.
- `clear` `Remove formatting` (`Ctrl+\`) strips inline formats and links from the selection.

## How to get to it (user POV)

- `Compose` (new email) — the toolbar sits above the Message field.
- Drafts folder → a draft row — the same toolbar in the draft editor.
- A conversation → `reply` / `reply all` / `forward` — the same toolbar in the inline composer.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run; `scripts/doctor.sh` exits 0.
- Mock seed includes the stored rich draft `Draft: formatted launch notes` (`draft-rich`) whose html carries bold, italic, underline, both list kinds, a link to `https://example.com/runbook`, and a styled blockquote; and the `Launch checklist` thread for reply/forward.

Run `node scripts/drive.mjs --feature rich-text --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. One routine (`formatRichBody`) drives every command through its real button or shortcut at the body start on each surface, asserting the pressed states as it goes: bold then `Remove formatting` over a `Shift+Home` selection, bold, `Ctrl+I` italic, underline, a link whose `javascript:` address is refused before `mailsy.example/docs` applies as `https://mailsy.example/docs`, a two-item bulleted list, a `Ctrl+Shift+7` numbered list, and a quote.

- **New compose.** The body html, the autosave in `window.__draftSaves`, and the `window.__sent` record all carry every format; the transcript quotes the outbox html.
- **Draft editing.** Opening `draft-rich` shows the stored list, numbered list, bold, quote and link pressed when the caret enters them; `Ctrl+K` on the link opens it for editing and `Remove link` unlinks while keeping the words. The new formats then ride the autosave for `draft-rich` alongside the stored ones, survive a leave-and-reopen of the draft, and the send (`draftId: 'draft-rich'`) carries them.
- **Reply / forward.** The reply body formats above the quote; the caret inside the native reply quote leaves `Quote` unpressed; the send keeps `inReplyTo`, the `gmail_quote_container` and the quoted text. The forward formats likewise and keeps its `Forwarded message` block.
- **Proof.** `rich-text-compose`, `rich-text-draft`, `rich-text-reply`, and `rich-text` `.aria.txt`/`.png`, plus `rich-text.log`.

## Gotchas

- Toolbar buttons `preventDefault` on mousedown so the editor keeps its selection; the editor also remembers its last in-editor range (a `selectionchange` subscription) so a command issued after focus left the body still lands where the caret was.
- The `Edit link` group captures the selection when it opens and restores it on apply: typing into its inputs moves focus out of the body. Enter in the group applies the link instead of submitting the composer; Escape cancels.
- At a caret placed directly before stored bold text, `queryCommandState('bold')` already reports bold, so Bold turns it off (same as Gmail). The seeded draft starts with a plain line so the journey's caret at the body start is unformatted.
- Enter outside a list is still the editor's `insertLineBreak`, which in the `pre-wrap` body stores a `\n` text node, not `<br>`; inside a list item the native Enter runs so lists grow and exit like Gmail's.
- The `bodyHtml` that rides sends and autosaves is not `innerHTML`: `serializeBodyHtml` (`lib/richText.ts`) clones the body and rewrites each user-authored `\n` to `<br>` and line-start/2+-space runs to `&nbsp;`, so the recipient sees the same line breaks without `pre-wrap`. Text inside the `.gmail_quote_container` native quote, the `.mailsy-signature` block and `<pre>` is source html, not typing — it stays byte-identical.
- Caret-navigation presses in `drive.mjs` go through the `KEYS` map, never a literal key name, because on darwin Playwright maps `Home`/`End`/`Shift+Home`/`Shift+End`/`Control+Home`/`Control+End`/`Control+A` to Mac editing commands (scroll, document-wide selection, Emacs moves) instead of Linux-style caret moves. The keystrokes stay real — they exercise the caret-move `history.seal()` path — only the key name switches to the `Meta+Arrow…`/`Meta+A` equivalent on macOS.
- `drive/ui-pass-probe.mjs` must still end `PROBE: all pass` after toolbar or editor changes.
- Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, and the Edit menu's `historyUndo`/`historyRedo`) run through the editor's own snapshot history in `lib/editorHistory.ts`, not the browser's. Several edits move DOM nodes directly (quoted-list unquote, Backspace merges, signatures, image inserts), and the native stack replays those against detached nodes. Every new mutation path must call `history.record(editor)` before it changes the DOM.
- Closing the link form with Cancel or Escape restores the body selection it was opened from, so typing continues in the body.
