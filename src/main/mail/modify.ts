import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { ModifyLabelsRequest } from '../../shared/types'
import { withQuotaRetry } from './resilience'

function assertModifyFields(request: ModifyLabelsRequest): void {
  if (
    !request ||
    (request.kind !== 'message' && request.kind !== 'thread') ||
    ((!request.addLabelIds || request.addLabelIds.length === 0) &&
      (!request.removeLabelIds || request.removeLabelIds.length === 0)) ||
    request.addLabelIds?.some((id) => typeof id !== 'string') ||
    request.removeLabelIds?.some((id) => typeof id !== 'string')
  ) {
    throw new Error('Invalid modify request')
  }
  if (typeof request.id !== 'string' || !request.id.trim()) {
    throw new Error('Message or thread ID is required')
  }
}

// Label membership is Gmail's domain model: archive, trash, read/unread, and
// star are all add/remove of labels, so this unit stays generic rather than
// becoming an archive-only endpoint.
export async function modifyLabels(request: ModifyLabelsRequest): Promise<void> {
  assertModifyFields(request)

  const gmail: GmailClient = getGmailClient()
  const requestBody = {
    ...(request.addLabelIds?.length ? { addLabelIds: request.addLabelIds } : {}),
    ...(request.removeLabelIds?.length ? { removeLabelIds: request.removeLabelIds } : {})
  }

  await withQuotaRetry(() =>
    request.kind === 'message'
      ? gmail.users.messages.modify({ userId: 'me', id: request.id, requestBody })
      : gmail.users.threads.modify({ userId: 'me', id: request.id, requestBody })
  )
}
