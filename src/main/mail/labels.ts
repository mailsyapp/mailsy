import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { gmail_v1 } from 'googleapis'
import type { MailLabel } from '../../shared/types'
import { withQuotaRetry } from './resilience'

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

export async function listLabels(): Promise<MailLabel[]> {
  const gmail: GmailClient = getGmailClient()
  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  return (list.data.labels ?? []).flatMap((label) =>
    label.id && label.name ? [toLabel(label)] : []
  )
}

async function listUserLabels(gmail: GmailClient): Promise<gmail_v1.Schema$Label[]> {
  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  return (list.data.labels ?? []).filter((label) => (label.type ?? 'user') !== 'system')
}

export async function findUserLabelByName(
  gmail: GmailClient,
  name: string
): Promise<gmail_v1.Schema$Label | null> {
  const found = (await listUserLabels(gmail)).find(
    (label) => (label.name ?? '').toLowerCase() === name.toLowerCase()
  )
  return found ?? null
}

const pendingCreates = new Map<string, Promise<gmail_v1.Schema$Label>>()

export function createUserLabelByName(
  gmail: GmailClient,
  name: string
): Promise<gmail_v1.Schema$Label> {
  const key = name.toLowerCase()
  const pending = pendingCreates.get(key)
  if (pending) return pending
  const run = (async (): Promise<gmail_v1.Schema$Label> => {
    const created = await withQuotaRetry(() =>
      gmail.users.labels.create({ userId: 'me', requestBody: { name } })
    )
    if (!created.data.id) throw new Error('Gmail did not return an id for the created label')
    return created.data
  })()
  pendingCreates.set(key, run)
  void run.catch(() => {})
  void run.finally(() => {
    if (pendingCreates.get(key) === run) pendingCreates.delete(key)
  })
  return run
}

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

export async function deleteUserLabel(id: string): Promise<void> {
  if (!id.trim()) throw new Error('Label ID is required')
  const gmail: GmailClient = getGmailClient()
  const label = await withQuotaRetry(() => gmail.users.labels.get({ userId: 'me', id }))
  if (label.data.type === 'system') throw new Error('System labels cannot be deleted')
  await withQuotaRetry(() => gmail.users.labels.delete({ userId: 'me', id }))
}
