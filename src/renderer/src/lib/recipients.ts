import type { EmailDetail } from '../../../shared/types'

function addressOf(entry: string): string {
  const angle = /<([^>]+)>/.exec(entry)
  return (angle ? angle[1] : entry).trim().toLowerCase()
}

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

export function replyAllRecipients(
  message: Pick<EmailDetail, 'from' | 'to' | 'cc' | 'replyTo'>,
  userEmail: string
): { to: string; cc: string } {
  const own = addressOf(userEmail)

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
