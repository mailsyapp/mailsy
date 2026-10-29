// Fixture window.api mock for verification runs. Injected via
// Playwright addInitScript BEFORE page scripts run. Stands in for the
// production boundary only (Gmail API + OAuth); contains no app logic.
// Label membership is the boundary's domain concept: folder listing and
// modifyLabels both read/write each message's labelIds like Gmail's
// labels API, and archived threads are just INBOX removals. All state is
// in-memory: every page load restarts from the seed mailbox.
(() => {
  const seed = [
    {
      id: 'msg-launch',
      threadId: 'thread-launch',
      from: 'Ada Lovelace <ada@example.com>',
      subject: 'Launch checklist',
      date: 'Tue, 13 Oct 2026 09:00:00 +0000',
      snippet: 'Final review of the launch checklist before Friday.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<launch@example.com>',
      references: '',
      bodyText: 'Final review of the launch checklist before Friday.\n- freeze scope\n- tag release',
      bodyHtml: '<p>Final review of the launch checklist before Friday.</p>'
    },
    {
      id: 'msg-budget',
      threadId: 'thread-budget',
      from: 'Grace Hopper <grace@example.com>',
      subject: 'Q3 budget draft',
      date: 'Mon, 12 Oct 2026 15:30:00 +0000',
      snippet: 'Attached is the draft budget for Q3 planning.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<budget@example.com>',
      references: '',
      bodyText: 'Attached is the draft budget for Q3 planning.',
      bodyHtml: '<p>Attached is the draft budget for Q3 planning.</p>'
    },
    {
      id: 'msg-thread-1',
      threadId: 'thread-deploy',
      from: 'Alan Turing <alan@example.com>',
      subject: 'Deploy window',
      date: 'Sun, 11 Oct 2026 10:00:00 +0000',
      snippet: 'Can we move the deploy window to Thursday?',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<deploy-1@example.com>',
      references: '',
      bodyText: 'Can we move the deploy window to Thursday?',
      bodyHtml: '<p>Can we move the deploy window to Thursday?</p>'
    },
    {
      id: 'msg-thread-2',
      threadId: 'thread-deploy',
      from: 'me@example.com',
      subject: 'Re: Deploy window',
      date: 'Sun, 11 Oct 2026 11:00:00 +0000',
      snippet: 'Thursday works. Locking it in.',
      to: 'alan@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<deploy-2@example.com>',
      references: '<deploy-1@example.com>',
      bodyText: 'Thursday works. Locking it in.',
      bodyHtml: '<p>Thursday works. Locking it in.</p>',
      folder: 'inbox'
    },
    {
      id: 'msg-draft-1',
      threadId: 'thread-draft-1',
      from: 'me@example.com',
      subject: 'Draft: Q4 planning notes',
      date: 'Wed, 14 Oct 2026 08:00:00 +0000',
      snippet: 'Unsent draft for Q4 planning.',
      to: 'team@example.com',
      cc: 'Grace Hopper <grace@example.com>',
      bcc: '',
      replyTo: '',
      messageId: '<draft-1@example.com>',
      inReplyTo: '<q4-plan-parent@example.com>',
      references: '<q4-plan-parent@example.com>',
      bodyText: 'Unsent draft for Q4 planning.',
      bodyHtml: '<p>Unsent draft for Q4 planning.</p>',
      folder: 'drafts',
      labelIds: ['DRAFT'],
      draftId: 'draft-1'
    }
  ].map((m) => ({ folder: 'inbox', labelIds: ['INBOX'], ...m }))

  // Reply-all fixture: one message carrying multi-recipient To plus Cc, so
  // the To line after reply all covers author + To + Cc with me dropped.
  seed.push({
    id: 'msg-standup',
    threadId: 'thread-standup',
    from: 'Ada Lovelace <ada@example.com>',
    subject: 'Standup notes',
    date: 'Fri, 16 Oct 2026 10:00:00 +0000',
    snippet: 'Notes from today, agenda for Friday plus an updated release hour.',
    to: 'me@example.com, Ben Franklin <ben@example.com>',
    cc: 'Nia Chambers <nia@example.com>',
    bcc: '',
    replyTo: '',
    messageId: '<standup@example.com>',
    references: '',
    bodyText: 'Notes from today, agenda for Friday plus an updated release hour.',
    bodyHtml: '<p>Notes from today, agenda for Friday plus an updated release hour.</p>',
    folder: 'inbox',
    labelIds: ['INBOX']
  })

  // Spam fixture: one message carrying only the SPAM label, so the Spam
  // view lists it while every other folder including All Mail excludes it.
  // Not UNREAD, so opening it never adds a stray auto-read modify call.
  seed.push({
    id: 'msg-spam-1',
    threadId: 'thread-spam-1',
    from: 'Marina Cruise <no-reply@lottery-wins.example>',
    subject: 'You won a free cruise',
    date: 'Thu, 15 Oct 2026 12:00:00 +0000',
    snippet: 'Claim your cruise ticket by replying with your bank details.',
    to: 'me@example.com',
    cc: '',
    bcc: '',
    replyTo: '',
    messageId: '<cruise@example.com>',
    references: '',
    bodyText: 'Claim your cruise ticket by replying with your bank details.',
    bodyHtml: '<p>Claim your cruise ticket by replying with your bank details.</p>',
    folder: 'spam',
    labelIds: ['SPAM']
  })

  // Snoozed fixture: one message parked by Gmail itself. The parking state
  // is a marker the mock answers from listFolder(folder:'snoozed') the way
  // the real API answers the in:snoozed query; it is NOT a writable label —
  // the real API rejects SNOOZED in both threads.list(labelIds) and
  // threads.modify with 400 "Invalid label: SNOOZED". Not UNREAD, opening it
  // never adds a stray auto-read modify call.
  seed.push({
    id: 'msg-snoozed-1',
    threadId: 'thread-snoozed-1',
    from: 'Priya Vance <priya@example.com>',
    subject: 'Vendor pricing follow-up',
    date: 'Fri, 9 Oct 2026 09:30:00 +0000',
    snippet: 'Bump this once the vendor answers on pricing.',
    to: 'me@example.com',
    cc: '',
    bcc: '',
    replyTo: '',
    messageId: '<snoozed-1@example.com>',
    references: '',
    bodyText: 'Bump this once the vendor answers on pricing.',
    bodyHtml: '<p>Bump this once the vendor answers on pricing.</p>',
    folder: 'snoozed',
    labelIds: ['SNOOZED']
  })
  seed.push({
    id: 'msg-snoozed-2',
    threadId: 'thread-snoozed-2',
    from: 'News Weekly <news@example.com>',
    subject: 'Newsletter backlog cleanup',
    date: 'Wed, 7 Oct 2026 08:00:00 +0000',
    snippet: 'Park the weekly roundup until a quiet moment.',
    to: 'me@example.com',
    cc: '',
    bcc: '',
    replyTo: '',
    messageId: '<snoozed-2@example.com>',
    references: '',
    bodyText: 'Park the weekly roundup until a quiet moment.',
    bodyHtml: '<p>Park the weekly roundup until a quiet moment.</p>',
    folder: 'snoozed',
    labelIds: ['SNOOZED']
  })

  // Category + Important fixtures: five threads each carrying one of the
  // documented Gmail system labels next to INBOX, so every view lists only
  // mail carrying its own label and each thread stays listed in All Mail
  // (the no-label default excludes only SPAM and TRASH). Not UNREAD, so
  // opening never adds a stray auto-read modify call.
  seed.push(
    {
      id: 'msg-important-1',
      threadId: 'thread-important-1',
      from: 'Morgan Vale <morgan@example.com>',
      subject: 'Budget approval needed by Friday',
      date: 'Mon, 5 Oct 2026 14:00:00 +0000',
      snippet: 'The Q3 numbers need your sign-off before the freeze.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<important-1@example.com>',
      references: '',
      bodyText: 'The Q3 numbers need your sign-off before the freeze.',
      bodyHtml: '<p>The Q3 numbers need your sign-off before the freeze.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'IMPORTANT']
    },
    {
      id: 'msg-social-1',
      threadId: 'thread-social-1',
      from: 'Ivy Everett <ivy@example.com>',
      subject: 'Weekend meetup photos',
      date: 'Sat, 3 Oct 2026 19:30:00 +0000',
      snippet: 'Added the shots from Saturday, take a look.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<social-1@example.com>',
      references: '',
      bodyText: 'Added the shots from Saturday, take a look.',
      bodyHtml: '<p>Added the shots from Saturday, take a look.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'CATEGORY_SOCIAL']
    },
    {
      id: 'msg-promotions-1',
      threadId: 'thread-promotions-1',
      from: 'Peak Outfitters <deals@peakoutfitters.example>',
      subject: 'Trail shoes flash sale',
      date: 'Fri, 2 Oct 2026 10:00:00 +0000',
      snippet: 'Today only: forty percent off the trail line.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<promotions-1@example.com>',
      references: '',
      bodyText: 'Today only: forty percent off the trail line.',
      bodyHtml: '<p>Today only: forty percent off the trail line.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS']
    },
    {
      id: 'msg-updates-1',
      threadId: 'thread-updates-1',
      from: 'Cloud Reports <reports@cloudmail.example>',
      subject: 'Your storage usage report',
      date: 'Thu, 1 Oct 2026 06:00:00 +0000',
      snippet: 'September usage stayed within the included tier.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<updates-1@example.com>',
      references: '',
      bodyText: 'September usage stayed within the included tier.',
      bodyHtml: '<p>September usage stayed within the included tier.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'CATEGORY_UPDATES']
    },
    {
      id: 'msg-forums-1',
      threadId: 'thread-forums-1',
      from: 'Dev Forum <notify@devforum.example>',
      subject: 'New reply in your thread',
      date: 'Wed, 30 Sep 2026 21:15:00 +0000',
      snippet: 'Someone answered your question about retry shapes.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: '<forums-1@example.com>',
      references: '',
      bodyText: 'Someone answered your question about retry shapes.',
      bodyHtml: '<p>Someone answered your question about retry shapes.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'CATEGORY_FORUMS']
    }
  )

  // labels-feature seed (features/labels.md): one inbox thread carrying a
  // user label id, the seed the label's rail chip totals and its list view
  // answer from. Read mail, so opening it never adds a stray auto-read
  // modify call, and nothing else in the seed carries 'label-receipts'.
  seed.push({
    id: 'msg-receipts-1',
    threadId: 'thread-receipts-1',
    from: 'South Terminal <receipts@southterminal.example>',
    subject: 'Receipts for March travel',
    date: 'Sat, 10 Oct 2026 07:30:00 +0000',
    snippet: 'Two receipts attached from the March travel batch.',
    to: 'me@example.com',
    cc: '',
    bcc: '',
    replyTo: '',
    messageId: '<receipts-1@example.com>',
    references: '',
    bodyText: 'Two receipts attached from the March travel batch.',
    bodyHtml: '<p>Two receipts attached from the March travel batch.</p>',
    folder: 'inbox',
    labelIds: ['INBOX', 'label-receipts']
  })

  const byId = new Map(seed.map((m) => [m.id, m]))
  // Mailsy's own parking label: the emulated snooze writes it plus INBOX
  // removal (main's snooze module), and it is a real Gmail-side user label,
  // listable through labelIds — unlike the SNOOZED pseudo-label, which no
  // write may touch.
  const MAILSY_SNOOZE_LABEL = 'Snoozed by Mailsy'
  const FOLDER_LABELS = {
    inbox: 'INBOX',
    drafts: 'DRAFT',
    sent: 'SENT',
    trash: 'TRASH',
    spam: 'SPAM',
    starred: 'STARRED',
    important: 'IMPORTANT',
    social: 'CATEGORY_SOCIAL',
    promotions: 'CATEGORY_PROMOTIONS',
    updates: 'CATEGORY_UPDATES',
    forums: 'CATEGORY_FORUMS'
  }
  const sent = []
  const mods = []
  const deletedDrafts = []
  // Recorded draft writes and discards for the autosave proof: each save
  // carries the resolved draft id (created on the first write), each
  // discard the id it removed.
  const draftSaves = []
  const draftDiscards = []
  // The mock's stand-in for the stored refresh token: true until the
  // sign-out boundary call clears it.
  let signedIn = true
  const PAGE_SIZE = 30

  function summary(m) {
    return {
      id: m.id,
      threadId: m.threadId,
      from: m.from,
      subject: m.subject,
      date: m.date,
      snippet: m.snippet,
      // Mirrors the boundary contract EmailSummary now carries: unread is
      // the presence of the UNREAD label, flattened where the summary is
      // built, never parsed in the renderer.
      unread: (m.labelIds || []).includes('UNREAD'),
      // Starred is the STARRED label flattened exactly like unread; the
      // boundary contract in EmailSummary carries both.
      starred: (m.labelIds || []).includes('STARRED'),
      ...(m.draftId ? { draftId: m.draftId } : {})
    }
  }

  // One list row per conversation, mirroring the boundary's ThreadSummary:
  // thread id as row id, first message's subject, latest message's snippet
  // and date, distinct senders, and label aggregates across the messages.
  function threadRowOf(messages) {
    const first = messages[0]
    const last = messages[messages.length - 1]
    const participants = []
    for (const m of messages) {
      if (m.from && !participants.includes(m.from)) participants.push(m.from)
    }
    const row = {
      id: last.threadId || first.threadId,
      subject: first.subject || last.subject || '(no subject)',
      snippet: last.snippet || '',
      participants,
      date: last.date || first.date || '',
      messageIds: messages.map((m) => m.id),
      unreadCount: messages.filter((m) => (m.labelIds || []).includes('UNREAD')).length,
      starred: messages.some((m) => (m.labelIds || []).includes('STARRED'))
    }
    if (last.draftId) row.draftId = last.draftId
    if (messages.some((m) => (m.labelIds || []).includes(MAILSY_SNOOZE_LABEL))) {
      row.snoozedByMailsy = true
    }
    return row
  }

  function pageSlice(rows, options) {
    const start = options.pageToken ? parseInt(options.pageToken, 10) || 0 : 0
    const size = options.maxResults || PAGE_SIZE
    const slice = rows.slice(start, start + size)
    return {
      threads: slice,
      nextPageToken: start + size < rows.length ? String(start + size) : null
    }
  }

  // Minimal Gmail-style query support: plain text matches subject/from/snippet,
  // tokens shaped like `key:value` are passed through as a literal filter.
  function matches(m, q) {
    if (!q || !q.trim()) return true
    const hay = `${m.subject} ${m.from} ${m.snippet}`.toLowerCase()
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((tok) => hay.includes(tok))
  }

  window.__sent = sent
  window.__mods = mods
  window.__seedIds = seed.map((m) => m.id)
  window.__draftSaves = draftSaves
  window.__draftDiscards = draftDiscards

  // Mirrors the real boundary: getGmailClient throws this exact sentence
  // when no stored token exists, and recordError flips to the sign-in
  // screen when it matches. Fixtures serving mail to a signed-out client
  // would paper over the renderer's fetch guards.
  function ensureSignedIn() {
    if (!signedIn) throw new Error('Not signed in yet')
  }

  window.api = {
    signIn: async () => undefined,
    isSignedIn: async () => signedIn,
    // Mirrors the sign-out bridge: the stored token is dropped in memory the
    // way the real bridge deletes the token file, so isSignedIn() flips to
    // false afterward. The recording lets the driver read the call back.
    signOut: async () => {
      window.__signOutClicked = true
      signedIn = false
    },
    listFolder: async (options = {}) => {
      ensureSignedIn()
      const q = options.q || ''
      const folder = options.folder || 'inbox'
      // Drafts stay one row per draft message (the real boundary enumerates
      // drafts.list, not threads.list) so each draft wrap carries its
      // draftId for the send path.
      if (folder === 'drafts') {
        const rows = seed
          .filter((m) => m.draftId && !deletedDrafts.includes(m.draftId))
          .filter((m) => matches(m, q))
          .map((m) => threadRowOf([m]))
        return pageSlice(rows, options)
      }
      const label =
        folder === 'label'
          ? // A user-label view lists through the userLabelId option; the
            // missing-id error mirrors main's folder guard so the boundary
            // keeps discrimination instead of defaulting to INBOX.
            (() => {
              if (!options.userLabelId) throw new Error('A user label view needs a label id')
              return options.userLabelId
            })()
          : folder === 'all'
            ? null
            : FOLDER_LABELS[folder] || 'INBOX'
      // The Snoozed view answers the in:snoozed query on the parking
      // marker, not a labelIds filter: the real API rejects
      // labelIds:['SNOOZED'] with 400 "Invalid label". Mailsy's own park
      // write carries the user label instead, and that label IS listable
      // through labelIds, so the emulated set joins the union the way
      // main's fetchSnoozed merges both legs.
      const parkedOnly = folder === 'snoozed'
      const matched = seed
        .filter((m) =>
          folder === 'label'
            ? (m.labelIds || []).includes(label)
            : parkedOnly
              ? (m.labelIds || []).includes('SNOOZED') ||
                (m.labelIds || []).includes(MAILSY_SNOOZE_LABEL)
              : !label || (m.labelIds || []).includes(label)
        )
        // Gmail's listing default leaves SPAM and TRASH out of the
        // label-free All Mail and the Snoozed query alike.
        .filter(
          (m) =>
            (folder !== 'all' && !parkedOnly && folder !== 'label') ||
            (!(m.labelIds || []).includes('TRASH') && !(m.labelIds || []).includes('SPAM'))
        )
        .filter((m) => !(m.draftId && deletedDrafts.includes(m.draftId)))
        .filter((m) => matches(m, q))
      // Group matched messages by thread in first-appearance order: the row
      // appears where the thread's first message ranked.
      const groups = new Map()
      for (const m of matched) {
        if (!groups.has(m.threadId)) groups.set(m.threadId, [])
        groups.get(m.threadId).push(m)
      }
      return pageSlice([...groups.values()].map(threadRowOf), options)
    },
    getMessage: async (id) => {
      ensureSignedIn()
      const m = byId.get(id)
      if (!m) throw new Error(`mock: no message ${id}`)
      return { ...m }
    },
    getThread: async (threadId) => {
      ensureSignedIn()
      const messages = seed.filter((m) => m.threadId === threadId).map((m) => ({ ...m }))
      if (messages.length === 0) throw new Error(`mock: no thread ${threadId}`)
      // The thread's full label id set, deduped, mirroring the boundary
      // contract EmailThread now carries for the labels menu.
      const labelIds = []
      for (const m of messages) {
        for (const labelId of m.labelIds || []) {
          if (!labelIds.includes(labelId)) labelIds.push(labelId)
        }
      }
      return {
        id: threadId,
        messages,
        labelIds,
        // Mirrors the account email the real boundary now carries on thread
        // fetches; the exclusion set for the reply-all derivation.
        userEmail: 'me@example.com'
      }
    },
    sendEmail: async (request) => {
      ensureSignedIn()
      // Same receipt rule as main's boundary: any one address list of the
      // three survives a send.
      if (
        !request ||
        (!(request.to || '').trim() && !(request.cc || '').trim() && !(request.bcc || '').trim())
      ) {
        throw new Error('Recipient is required')
      }
      sent.push({ ...request })
    },
    // Mirrors drafts.update + drafts.send: the sent content is recorded and
    // the draft disappears from the Drafts folder in one step. Throws on an
    // unknown draft ID (e.g. a message ID passed by mistake) so the mock
    // keeps discriminating ID confusion like the live API's 404 would.
    sendDraft: async (request) => {
      ensureSignedIn()
      if (!request || !request.draftId || !request.draftId.trim()) {
        throw new Error('Draft ID is required')
      }
      if (
        !(request?.to || '').trim() &&
        !(request?.cc || '').trim() &&
        !(request?.bcc || '').trim()
      ) {
        throw new Error('Recipient is required')
      }
      const target = seed.find((m) => m.draftId === request.draftId)
      if (!target) throw new Error(`mock: no draft ${request.draftId}`)
      sent.push({ ...request })
      deletedDrafts.push(request.draftId)
    },
    // Mirrors saveDraft: a write with no draft id creates a draft-shaped
    // seed entry (own singleton thread, DRAFT label) and answers its id;
    // a write with one updates the stored draft in place the way
    // drafts.update replaces the message. Send-style validation only:
    // Gmail keeps recipient-less drafts, so To may be empty here.
    saveDraft: async (request) => {
      ensureSignedIn()
      if (
        !request ||
        typeof request.to !== 'string' ||
        typeof request.subject !== 'string' ||
        typeof request.body !== 'string' ||
        (request.cc !== undefined && typeof request.cc !== 'string') ||
        (request.bcc !== undefined && typeof request.bcc !== 'string') ||
        (request.threadId !== undefined && typeof request.threadId !== 'string')
      ) {
        throw new Error('Invalid draft request')
      }
      if (request.draftId !== undefined && typeof request.draftId !== 'string') {
        throw new Error('Invalid draft request')
      }
      let draftId
      if (request.draftId) {
        const target = seed.find((m) => m.draftId === request.draftId)
        if (!target) throw new Error(`mock: no draft ${request.draftId}`)
        draftId = target.draftId
        target.to = request.to
        target.cc = request.cc || ''
        target.bcc = request.bcc || ''
        target.subject = request.subject
        target.bodyText = request.body
        delete target.bodyHtml
        target.snippet = request.body
      } else {
        draftId = `draft-save-${draftSaves.length + 1}`
        const id = `msg-${draftId}`
        const message = {
          id,
          threadId: id,
          from: 'me@example.com',
          subject: request.subject,
          date: new Date().toUTCString(),
          snippet: request.body,
          to: request.to,
          cc: request.cc || '',
          bcc: request.bcc || '',
          replyTo: '',
          messageId: `<${draftId}@example.com>`,
          inReplyTo: request.inReplyTo || '',
          references: request.references || '',
          bodyText: request.body,
          folder: 'drafts',
          labelIds: ['DRAFT'],
          draftId
        }
        seed.push(message)
        byId.set(id, message)
      }
      draftSaves.push({ ...request, draftId })
      return draftId
    },
    // Mirrors drafts.delete from the explicit Cancel path. A vanished draft
    // is already gone, so the boundary settles it as success; the mock
    // records the id either way.
    discardDraft: async (draftId) => {
      ensureSignedIn()
      if (typeof draftId !== 'string' || !draftId.trim()) {
        throw new Error('Draft ID is required')
      }
      // Like sendDraft's consumption: the draft leaves the folder listing,
      // and an already-consumed ids row can never reappear through the
      // exclusion filter.
      deletedDrafts.push(draftId)
      draftDiscards.push({ draftId })
    },
    // Mirrors gmail.users.messages/threads.modify: error strings match the
    // main process validation, targets resolve by threadId or id, and the
    // mutation is add/remove on each target's labelIds only. Two boundary
    // truths are modeled exactly like the live API: SNOOZED is not a
    // writable label (400 "Invalid label: SNOOZED"), and re-adding INBOX is
    // what ends Gmail's parking state, so that add clears the marker.
    modifyLabels: async (request) => {
      ensureSignedIn()
      const hasMods =
        (request && Array.isArray(request.addLabelIds) && request.addLabelIds.length > 0) ||
        (Array.isArray(request?.removeLabelIds) && request.removeLabelIds.length > 0)
      const stringOnly = (list) => list.every((id) => typeof id === 'string')
      if (
        !request ||
        (request.kind !== 'message' && request.kind !== 'thread') ||
        !hasMods ||
        (request.addLabelIds && !stringOnly(request.addLabelIds)) ||
        (request.removeLabelIds && !stringOnly(request.removeLabelIds))
      ) {
        throw new Error('Invalid modify request')
      }
      if (typeof request.id !== 'string' || !request.id.trim()) {
        throw new Error('Message or thread ID is required')
      }
      const touchesSnoozed =
        (request.addLabelIds ?? []).includes('SNOOZED') ||
        (request.removeLabelIds ?? []).includes('SNOOZED')
      if (touchesSnoozed) throw new Error('Invalid label: SNOOZED')
      const targets =
        request.kind === 'thread'
          ? seed.filter((m) => m.threadId === request.id)
          : seed.filter((m) => m.id === request.id)
      if (targets.length === 0) throw new Error(`mock: no ${request.kind} ${request.id}`)
      for (const target of targets) {
        const labelIds = target.labelIds ?? []
        for (const id of request.addLabelIds ?? []) {
          if (!labelIds.includes(id)) labelIds.push(id)
        }
        for (const id of request.removeLabelIds ?? []) {
          const i = labelIds.indexOf(id)
          if (i !== -1) labelIds.splice(i, 1)
        }
        if (labelIds.includes('INBOX')) {
          const snoozed = labelIds.indexOf('SNOOZED')
          if (snoozed !== -1) labelIds.splice(snoozed, 1)
        }
        target.labelIds = labelIds
      }
      mods.push({ ...request })
    }
  }

  // Mailsy's snooze emulation, mirroring main's snooze module at the
  // bridge surface: the parking state is the MAILSY_SNOOZE_LABEL user
  // label plus INBOX removal, the Map is the schedule of record, and the
  // restore (a tick's sweep or a manual unsnooze) applies the reverse pair
  // and drops the record. Every application goes through the same label
  // machinery modifyLabels uses, including the SNOOZED-marker end on the
  // INBOX add. No timer lives here; the driver's clock API advances the
  // page's Date the same way main's timer and the renderer tick observe it.
  const snoozeSchedule = new Map()
  window.__snoozeSchedule = snoozeSchedule

  function applyThreadLabels(threadId, addLabelIds, removeLabelIds) {
    const targets = seed.filter((m) => m.threadId === threadId)
    if (targets.length === 0) throw new Error(`mock: no thread ${threadId}`)
    for (const target of targets) {
      const labelIds = target.labelIds ?? []
      for (const id of addLabelIds) {
        if (!labelIds.includes(id)) labelIds.push(id)
      }
      for (const id of removeLabelIds) {
        const i = labelIds.indexOf(id)
        if (i !== -1) labelIds.splice(i, 1)
      }
      if (labelIds.includes('INBOX')) {
        const snoozed = labelIds.indexOf('SNOOZED')
        if (snoozed !== -1) labelIds.splice(snoozed, 1)
      }
      target.labelIds = labelIds
    }
  }

  window.api.snoozeThread = async (threadId, restoreAt) => {
    ensureSignedIn()
    if (typeof threadId !== 'string' || !threadId.trim()) {
      throw new Error('Thread ID is required')
    }
    if (typeof restoreAt !== 'number' || !Number.isFinite(restoreAt) || restoreAt <= Date.now()) {
      throw new Error('Snooze wake time is required')
    }
    applyThreadLabels(threadId, [MAILSY_SNOOZE_LABEL], ['INBOX'])
    snoozeSchedule.set(threadId, restoreAt)
    mods.push({ kind: 'thread', id: threadId, addLabelIds: [MAILSY_SNOOZE_LABEL], removeLabelIds: ['INBOX'] })
  }

  window.api.restoreThread = async (threadId) => {
    ensureSignedIn()
    if (typeof threadId !== 'string' || !threadId.trim()) {
      throw new Error('Thread ID is required')
    }
    applyThreadLabels(threadId, ['INBOX'], [MAILSY_SNOOZE_LABEL])
    snoozeSchedule.delete(threadId)
    mods.push({ kind: 'thread', id: threadId, addLabelIds: ['INBOX'], removeLabelIds: [MAILSY_SNOOZE_LABEL] })
  }

  window.api.snoozeTick = async () => {
    ensureSignedIn()
    let restored = 0
    for (const [threadId, restoreAt] of [...snoozeSchedule]) {
      if (restoreAt > Date.now()) continue
      try {
        applyThreadLabels(threadId, ['INBOX'], [MAILSY_SNOOZE_LABEL])
        restored++
        mods.push({
          kind: 'thread',
          id: threadId,
          addLabelIds: ['INBOX'],
          removeLabelIds: [MAILSY_SNOOZE_LABEL]
        })
      } catch {
        // A vanished thread drops out of the schedule, the sweep's not-found
        // rule, so one dead record never blocks the others.
      }
      snoozeSchedule.delete(threadId)
    }
    return restored
  }

  // Mailsy's user-label browsing, additive for the labels feature (its own
  // RUN_ID serves each run): the mock stands in for labels.list/create/
  // delete exactly as the boundary answers — one created label per name,
  // totals derived from message label state, and system labels never
  // listed here; the create path mirrors main's parent chain above.
  const mockUserLabels = [
    {
      id: 'label-receipts',
      name: 'Receipts',
      color: { backgroundColor: '#7627bb', textColor: '#ffffff' }
    }
  ]
  let mockCreatedLabelCount = 0

  function mockLabelOf(label) {
    const carrying = seed.filter((m) => (m.labelIds || []).includes(label.id))
    return {
      id: label.id,
      name: label.name,
      type: 'user',
      color: label.color
        ? {
            background: `#${(label.color.backgroundColor || '').replace(/^#/, '')}`,
            text: `#${(label.color.textColor || '').replace(/^#/, '')}`
          }
        : null,
      messagesTotal: carrying.length,
      threadsTotal: new Set(carrying.map((m) => m.threadId)).size
    }
  }

  window.api.listLabels = async () => mockUserLabels.map(mockLabelOf)

  window.api.createUserLabel = async (name) => {
    ensureSignedIn()
    if (typeof name !== 'string' || !name.trim()) throw new Error('Label name is required')
    // Mirrors main's createUserLabel at the bridge surface: the Gmail API
    // stores one flat label per name and never auto-creates a parent, so
    // the app walks the slash segments and creates each missing ancestor
    // first (see features/labels.md). Names repeat case-insensitively, the
    // way Gmail treats duplicates, and an existing label is returned as-is.
    const raw = name.trim()
    const known = new Set(mockUserLabels.map((label) => label.name.toLowerCase()))
    let created = null
    const make = (labelName) => {
      if (known.has(labelName.toLowerCase())) return null
      const label = {
        id: `label-created-${++mockCreatedLabelCount}`,
        name: labelName,
        color: null
      }
      mockUserLabels.push(label)
      return label
    }
    const segments = raw.split('/')
    for (let i = 1; i < segments.length; i++) {
      created = make(segments.slice(0, i).join('/')) ?? created
    }
    created = make(raw) ?? created
    return mockLabelOf(created ?? mockUserLabels.find((l) => l.name === raw))
  }

  window.api.deleteUserLabel = async (id) => {
    ensureSignedIn()
    if (typeof id !== 'string' || !id.trim()) throw new Error('Label ID is required')
    const index = mockUserLabels.findIndex((label) => label.id === id)
    if (index === -1) throw new Error(`mock: no user label ${id}`)
    const [removed] = mockUserLabels.splice(index, 1)
    // A deleted label leaves the messages too, Gmail's delete behavior.
    for (const m of seed) {
      const labelIds = m.labelIds || []
      const at = labelIds.indexOf(removed.id)
      if (at !== -1) labelIds.splice(at, 1)
    }
  }

  // The sync surface (real-time refresh), standing in for the bridge's
  // canonical sweep entry and the push channel main fires for clock and
  // focus sweeps: syncMail counts button reasons (the in-flight dedupe
  // proof reads it back), the delay knob makes a sweep long enough for
  // the button's busy state to be observable, and __deliverMail +
  // __pushSync hand the driver the delta/reset pair the real main
  // process would push.
  window.__syncReasons = []
  let syncListeners = []
  let syncDelayMs = 0
  let syncError = null
  let deliveredCount = 0

  window.api.syncMail = async (reason) => {
    ensureSignedIn()
    if (reason === 'button') window.__syncReasons.push(reason)
    if (syncDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, syncDelayMs))
    if (syncError) throw new Error(syncError)
    return { kind: 'delta', historyId: 'mock-cursor', threads: [], deletedThreadIds: [] }
  }

  window.api.onSyncResult = (listener) => {
    syncListeners.push(listener)
    return () => {
      syncListeners = syncListeners.filter((l) => l !== listener)
    }
  }

  window.__setSyncDelay = (ms) => {
    syncDelayMs = ms
  }

  window.__setSyncError = (message) => {
    syncError = message
  }

  window.__pushSync = (result) => {
    for (const listener of [...syncListeners]) listener(result)
  }

  // Adds one single-message thread to the mailbox so a sweep has real
  // movement behind it, and answers the same delta shape the real
  // boundary builds: a fresh list row plus the thread's current label
  // set, so pushing it is the faithful stand-in for main's pushed sweep.
  window.__deliverMail = ({ from, subject, snippet }) => {
    const n = ++deliveredCount
    const message = {
      id: `msg-delivered-${n}`,
      threadId: `thread-delivered-${n}`,
      from: from || 'Sweep Wire <news@delivered.example>',
      subject: subject || `Delivered mid-session ${n}`,
      date: 'Tue, 20 Oct 2026 12:00:00 +0000',
      snippet: snippet || 'Fresh mail the sweep pushed between folds.',
      to: 'me@example.com',
      cc: '',
      bcc: '',
      replyTo: '',
      messageId: `<delivered-${n}@example.com>`,
      references: '',
      bodyText: snippet || 'Fresh mail the sweep pushed between folds.',
      bodyHtml: '<p>Fresh mail the sweep pushed between folds.</p>',
      folder: 'inbox',
      labelIds: ['INBOX', 'UNREAD']
    }
    seed.push(message)
    byId.set(message.id, message)
    const delta = {
      kind: 'delta',
      historyId: `mock-cursor-${n}`,
      threads: [{ ...threadRowOf([message]), labelIds: ['INBOX', 'UNREAD'] }],
      deletedThreadIds: []
    }
    return { delta, subject: message.subject }
  }
})()
