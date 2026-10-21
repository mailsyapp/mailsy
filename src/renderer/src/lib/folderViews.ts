import type { MailFolder } from '../../../shared/types'

// One config row per folder view: the rail-adjacent heading name, the
// empty-state sentence, and whether the folder's last unfiltered page may
// back the local Fuse fallback (fallbackToLocal). Inbox only for the
// fallback, by design: other folders must not surface messages from
// another folder's cache.
export const FOLDER_CONFIG: Record<
  MailFolder,
  { label: string; empty: string; fallbackToLocal: boolean }
> = {
  inbox: { label: 'Inbox', empty: 'You’re all caught up', fallbackToLocal: true },
  drafts: { label: 'Drafts', empty: 'No drafts yet', fallbackToLocal: false },
  sent: { label: 'Sent', empty: 'No sent mail yet', fallbackToLocal: false },
  trash: { label: 'Trash', empty: 'Trash is empty', fallbackToLocal: false },
  spam: { label: 'Spam', empty: 'Spam is empty', fallbackToLocal: false },
  snoozed: { label: 'Snoozed', empty: 'No snoozed mail', fallbackToLocal: false },
  // The user-label view: the heading and landmark read the open label's
  // name (activeLabel), so this row only fixes the config contract.
  label: { label: 'Labels', empty: 'No mail with this label', fallbackToLocal: false },
  starred: { label: 'Starred', empty: 'No starred mail yet', fallbackToLocal: false },
  important: { label: 'Important', empty: 'No important mail yet', fallbackToLocal: false },
  social: { label: 'Social', empty: 'No social mail yet', fallbackToLocal: false },
  promotions: { label: 'Promotions', empty: 'No promotions yet', fallbackToLocal: false },
  updates: { label: 'Updates', empty: 'No updates yet', fallbackToLocal: false },
  forums: { label: 'Forums', empty: 'No forum mail yet', fallbackToLocal: false },
  all: { label: 'All Mail', empty: 'No mail yet', fallbackToLocal: false }
}
