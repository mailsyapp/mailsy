# Rich-text formatting

The compose body formats text the way Gmail's composer does: a formatting bar under the body (with matching keyboard shortcuts) applies bold, italic, underline, links, bulleted and numbered lists, block quotes, and clears formatting. The bar is part of the shared composer body, so new compose, the draft editor, and the reply/forward composer all get the same controls and behavior. The result is ordinary body html: it rides the draft autosave and the send as `bodyHtml` beside the plain-text `body`, with no extra payload field.

## Sub-features

- `inline-formats` toggles `Bold` (Ctrl+B), `Italic` (Ctrl+I), and `Underline` (Ctrl+U) at the caret or on a selection; each button's pressed state follows the caret.
- `links` opens the `Edit link` panel from `Insert link` or Ctrl+K. `Text to display` is prefilled from the selection, and `Link to` accepts web or email addresses (`mailsy.example` becomes `https://mailsy.example/`, `name@host` becomes `mailto:name@host`). Unsafe schemes such as `javascript:` show an inline alert. With the caret in an existing link, the panel loads its address and offers `Remove link`.
- `lists` starts a `Bulleted list` (Ctrl+Shift+8) or `Numbered list` (Ctrl+Shift+7). Enter adds an item, and Enter on an empty item leaves the list.
- `quote` toggles a Gmail-style block quote (Ctrl+Shift+9) on the current paragraph. Toggling it inside an existing quote lifts only that paragraph out, so a new line after a stored quote can leave it without unquoting the rest.
- `clear` (`Remove formatting`, Ctrl+\\) strips inline styles and links from the selection while keeping its text.
- `roundtrip` carries the html through the autosave, through the Drafts-folder reopen (the bar re-derives its pressed state from the stored html), and through every send.

## How to get to it (user POV)

- `Compose` (new email): the bar sits directly under the `Message` body, above the signature row.
- Drafts folder → a draft row: the same bar in the draft editor.
- A conversation → `reply` / `reply all` / `forward`: the same bar in the inline composer, above the quoted message.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run; `scripts/doctor.sh` exits 0.
- Mock signed in with the standard seed (empty outbox and draft-save log, `Launch checklist` in the Inbox).

Run `node scripts/drive.mjs --feature rich-text --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Each surface runs the same format pass, tagged with the surface name. The pass uses Bold on/off, Ctrl+I, Underline, a link on the selected `Mailsy <tag>`, a two-item bulleted list and a two-step numbered list (each left with Enter on an empty item), bold text cleared with `Remove formatting`, and a quoted line toggled off and back on. After each pass, the editor html is parsed for every format.

- **New compose.** The pass also proves the `javascript:` link refusal. `rich-text-compose` captures the formatted body. The recorded autosave for `Rich text draft` carries every format in `bodyHtml` and a tag-free plain-text `body`.
- **Draft editing.** Walk away by a row click, then reopen `Rich text draft` from the Drafts rail. The stored formats are intact. Clicking stored bold, list, and link text presses `Bold`, `Numbered list`, and `Insert link`, and the link panel loads the stored address with `Remove link`. Clicking the stored quote, pressing Ctrl+End then Enter, and clicking `Quote` lifts the new line out of the stored quote. The draft pass follows (`rich-text-draft`). The autosave and the draft send each carry both the compose and draft formats.
- **Reply and forward.** On `Launch checklist`, `reply` and then `forward` (To `ada@example.com`) each run the pass from the body start. The links use Ctrl+K. The `gmail_quote_container` html stays byte-identical. Each send keeps the quote and the original `<p>` beside every format (`rich-text-reply`, `rich-text-forward`, final `rich-text`).

## Gotchas

- Toolbar buttons keep the editor selection by cancelling `mousedown`. A driver must click them, not focus them first, or the caret moves.
- The body editor is `white-space: pre-wrap`, so Chromium writes line breaks as `\n` text inside paragraphs. Paragraph commands (lists, quote) work on those `\n`-separated lines, which is why the quote-off path splits by paragraph boundary instead of relying on `outdent`.
- A caret placed at the editor's own end offset (`range.collapse(false)` on the editor) is not inside the last block's text. Click into the block and press Ctrl+End to land inside it the way a user does.
- Starting a new line at the very start of a draft that begins with bold text inherits bold, as in Gmail. The draft pass therefore appends after the stored quote.
