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

// labels.list answers system and user labels alike; user-label readers are
// the only writers of mailbox state, so listing filters to the user set
// (an undefined type name is a user label, per Gmail's schema default).
async function listUserLabels(gmail: GmailClient): Promise<gmail_v1.Schema$Label[]> {
  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  return (list.data.labels ?? []).filter((label) => (label.type ?? 'user') !== 'system')
}

// The canonical find-by-name: names are unique case-insensitively the way
// Gmail treats duplicate names, so a label differing only in case is the
// same label. Answers null when absent.
export async function findUserLabelByName(
  gmail: GmailClient,
  name: string
): Promise<gmail_v1.Schema$Label | null> {
  const found = (await listUserLabels(gmail)).find(
    (label) => (label.name ?? '').toLowerCase() === name.toLowerCase()
  )
  return found ?? null
}

// The canonical create: the raw labels.create write behind the quota retry,
// answering Gmail's whole label so callers decide how to read it. The flat
// write only — nesting and guards live in createUserLabel.
export async function createUserLabelByName(
  gmail: GmailClient,
  name: string
): Promise<gmail_v1.Schema$Label> {
  const created = await withQuotaRetry(() =>
    gmail.users.labels.create({ userId: 'me', requestBody: { name } })
  )
  return created.data
}

// Gmail's nesting has no API tree: a "Work/Deep" label is the flat name
// "Work/Deep", and the web UI nests it under a "Work" label shown alongside.
// The parent chain is created when missing, so the web UI's tree shows both
// levels. An already-existing label is returned from the first find instead
// of a 409.
export async function createUserLabel(name: string): Promise<MailLabel> {
  const gmail: GmailClient = getGmailClient()
  const labelName = name.trim()
  if (!labelName) throw new Error('Label name is required')

  const segments = labelName.split('/')
  if (segments.some((segment) => !segment.trim())) {
    throw new Error('Label name has an empty segment')
  }

  const existing = await findUserLabelByName(gmail, labelName)
  if (existing) return toLabel(existing)

  const userLabels = await listUserLabels(gmail)
  const known = new Set(userLabels.map((label) => (label.name ?? '').toLowerCase()))
  for (let i = 1; i < segments.length; i++) {
    const ancestor = segments.slice(0, i).join('/')
    if (known.has(ancestor.toLowerCase())) continue
    await createUserLabelByName(gmail, ancestor)
    known.add(ancestor.toLowerCase())
  }

  const created = await createUserLabelByName(gmail, labelName)
  return toLabel(created)
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
