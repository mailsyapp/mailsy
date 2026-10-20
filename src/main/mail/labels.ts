import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { gmail_v1 } from 'googleapis'
import type { MailLabel } from '../../shared/types'
import { withQuotaRetry } from './resilience'

// Gmail answers colors as six-digit hex strings; the harness displays them
// as CSS values, so only the hash needs prepending.
function stripHexPrefix(hex: string): string {
  return hex.replace(/^#/, '')
}

function toLabel(label: gmail_v1.Schema$Label): MailLabel {
  const color = label.color
  return {
    id: label.id ?? '',
    name: label.name ?? '',
    type: label.type === 'system' ? 'system' : 'user',
    color:
      // A label without colors keeps the rail's neutral chip.
      color?.backgroundColor && color?.textColor
        ? {
            background: `#${stripHexPrefix(color.backgroundColor)}`,
            text: `#${stripHexPrefix(color.textColor)}`
          }
        : null,
    messagesTotal: label.messagesTotal ?? 0,
    threadsTotal: label.threadsTotal ?? 0
  }
}

// labels.list answers system and user labels alike; the renderer picks one
// type per surface, so the boundary stays the whole honest list.
export async function listLabels(): Promise<MailLabel[]> {
  const gmail: GmailClient = getGmailClient()
  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  return (list.data.labels ?? []).flatMap((label) =>
    label.id && label.name ? [toLabel(label)] : []
  )
}

// Gmail's nesting has no API tree: a "Work/Deep" label is the flat name
// "Work/Deep", and the web UI nests it under a "Work" label shown alongside.
// The parent chain is created when missing, case-insensitively the way Gmail
// treats duplicate names, so the web UI's tree shows both levels.
export async function createUserLabel(name: string): Promise<MailLabel> {
  const gmail: GmailClient = getGmailClient()
  const labelName = name.trim()
  if (!labelName) throw new Error('Label name is required')

  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  const userLabels = (list.data.labels ?? []).filter((label) => (label.type ?? 'user') !== 'system')
  const known = new Set(userLabels.map((label) => (label.name ?? '').toLowerCase()))

  const segments = labelName.split('/')
  if (segments.some((segment) => !segment.trim())) {
    throw new Error('Label name has an empty segment')
  }

  const byName = (name: string): gmail_v1.Schema$Label | undefined =>
    userLabels.find((label) => (label.name ?? '').toLowerCase() === name.toLowerCase())

  // An already-existing label (or one differing only in case) is returned
  // from the first listing, mirroring Gmail's "names are unique" behavior
  // instead of a 409.
  const existing = byName(labelName)
  if (existing) return toLabel(existing)

  for (let i = 1; i < segments.length; i++) {
    const ancestor = segments.slice(0, i).join('/')
    if (known.has(ancestor.toLowerCase())) continue
    await withQuotaRetry(() =>
      gmail.users.labels.create({ userId: 'me', requestBody: { name: ancestor } })
    )
    known.add(ancestor.toLowerCase())
  }

  const created = await withQuotaRetry(() =>
    gmail.users.labels.create({ userId: 'me', requestBody: { name: labelName } })
  )
  return toLabel(created.data)
}

// labels.get runs first as the boundary's own guard: a system label id 404s
// or answers type SYSTEM before any delete call goes out at all.
export async function deleteUserLabel(id: string): Promise<void> {
  if (!id.trim()) throw new Error('Label ID is required')
  const gmail: GmailClient = getGmailClient()
  const label = await withQuotaRetry(() => gmail.users.labels.get({ userId: 'me', id }))
  if (label.data.type === 'system') throw new Error('System labels cannot be deleted')
  await withQuotaRetry(() => gmail.users.labels.delete({ userId: 'me', id }))
}
