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

// Gmail's reply-all model: the author (Reply-To overriding From) plus every
// To and Cc recipient, own addresses dropped, duplicate addresses collapsed.
// Order follows the headers so the composer shows the mail's own sequence.
// Returns the To line; an empty string means no recipient survives.
export function replyAllTargets(
  message: Pick<EmailDetail, 'from' | 'to' | 'cc' | 'replyTo'>,
  userEmail: string
): string {
  const own = addressOf(userEmail)
  const targets: string[] = []
  const seen = new Set<string>()
  const candidateLists = [message.replyTo || message.from, message.to, message.cc]
  for (const list of candidateLists) {
    for (const entry of recipientsOf(list)) {
      const address = addressOf(entry)
      if (!address || seen.has(address) || address === own) continue
      seen.add(address)
      targets.push(entry)
    }
  }
  return targets.join(', ')
}
