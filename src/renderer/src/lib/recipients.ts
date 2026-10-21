// Reply recipient derivation shared by the reply actions in the detail view.
// Kept out of the component so fast refresh stays valid and the rule stays
// testable in isolation.
import type { EmailDetail } from '../../../shared/types'

// "Ada Lovelace <ada@example.com>" and a bare "ada@example.com" both reduce
// to the address, the only stable key for comparing participants.
function addressOf(entry: string): string {
  const angle = /<([^>]+)>/.exec(entry)
  return (angle ? angle[1] : entry).trim().toLowerCase()
}

// Header values may quote a display name with embedded commas
// ("Doe, Jane" <jane@example.com>), so a bare split(',') mangles the To
// line. A comma only separates entries when no quote or bracket is open.
function recipientsOf(headerValue: string): string[] {
  const entries: string[] = []
  let quoted = false
  let brackets = 0
  let entry = ''
  for (const char of headerValue) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') brackets += 1
    else if (!quoted && char === '>') brackets = Math.max(0, brackets - 1)
    if (char === ',' && !quoted && brackets === 0) {
      const trimmed = entry.trim()
      if (trimmed) entries.push(trimmed)
      entry = ''
    } else {
      entry += char
    }
  }
  const last = entry.trim()
  if (last) entries.push(last)
  return entries
}

// The composer's three address lines. Omission is "not this field" for the
// patch handler and "never typed" for the receipt test.
export interface RecipientLines {
  to?: string
  cc?: string
  bcc?: string
}

// A composer may send when one of its three address lists survives: Cc-only
// and Bcc-only sends are legal, so To is not the whole receipt test.
export function hasRecipient({ to, cc, bcc }: RecipientLines): boolean {
  return Boolean(to?.trim() || cc?.trim() || bcc?.trim())
}

// Gmail's reply-all rule split across the two visible fields:
// - To keeps the author (Reply-To overriding From) plus the previous To
//   recipients.
// - Cc keeps the previous Cc recipients, skipping addresses already in To,
//   so no participant receives two copies.
// Both fields drop the user's own address first, so it never appears
// anywhere. Bcc is strictly what the user types; a reply always auto-fills
// nothing there. The lines keep the mail's own header order, and an empty
// string means no recipient survives in that field.
export function replyAllRecipients(
  message: Pick<EmailDetail, 'from' | 'to' | 'cc' | 'replyTo'>,
  userEmail: string
): { to: string; cc: string } {
  const own = addressOf(userEmail)

  // One address key carries both uniqueness and the own-address exclusion:
  // an address seen in a kept field is claimed, so a later list (Cc) never
  // re-fires it.
  function dedupe(list: string[], seen: Set<string>): string[] {
    return list.filter((entry) => {
      const address = addressOf(entry)
      if (!address || address === own || seen.has(address)) return false
      seen.add(address)
      return true
    })
  }

  const claimed = new Set<string>()
  const to = dedupe(
    [...recipientsOf(message.replyTo || message.from), ...recipientsOf(message.to)],
    claimed
  )
  const cc = dedupe(recipientsOf(message.cc), claimed)
  return { to: to.join(', '), cc: cc.join(', ') }
}
