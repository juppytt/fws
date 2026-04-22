import { Router, raw as expressRaw } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';
import { encodeGmailBase64 } from '../../util/base64.js';

const BASE = '/gmail/v1/users/:userId';
// Gmail's media-upload endpoints (used by gws >= 0.22 for +send/+reply/+forward)
// live under /upload/gmail/v1/... and POST the raw RFC822 message as the body
// with Content-Type: message/rfc822.
const UPLOAD_BASE = '/upload/gmail/v1/users/:userId';

export function gmailRoutes(): Router {
  const r = Router();

  // GET profile
  r.get(`${BASE}/profile`, (_req, res) => {
    res.json(getStore().gmail.profile);
  });

  // LIST messages
  r.get(`${BASE}/messages`, (req, res) => {
    const store = getStore();
    let messages = Object.values(store.gmail.messages);

    // Filter by labelIds
    const labelIds = req.query.labelIds;
    if (labelIds) {
      const labels = Array.isArray(labelIds) ? labelIds as string[] : [labelIds as string];
      messages = messages.filter(m => labels.every(l => m.labelIds.includes(l)));
    }

    // Filter by q
    const q = req.query.q as string | undefined;
    if (q) {
      messages = filterByQuery(messages, q);
    }

    // Sort by internalDate descending (newest first)
    messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));

    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 500);
    const result = messages.slice(0, maxResults);

    res.json({
      messages: result.map(m => ({ id: m.id, threadId: m.threadId })),
      resultSizeEstimate: result.length,
    });
  });

  // GET message
  r.get(`${BASE}/messages/:id`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }

    const format = (req.query.format as string) || 'full';
    if (format === 'minimal') {
      return res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds, snippet: msg.snippet, historyId: msg.historyId, internalDate: msg.internalDate, sizeEstimate: msg.sizeEstimate });
    }
    if (format === 'metadata') {
      return res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds, snippet: msg.snippet, historyId: msg.historyId, internalDate: msg.internalDate, sizeEstimate: msg.sizeEstimate, payload: { headers: msg.payload.headers } });
    }
    if (format === 'raw') {
      return res.json({ ...msg });
    }
    // full
    res.json(msg);
  });

  // SEND message
  r.post(`${BASE}/messages/send`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const threadId = req.body.threadId || generateId();
    const now = Date.now();

    let headers: Array<{ name: string; value: string }> = [];
    let bodyData = '';
    let snippet = '';

    if (req.body.raw) {
      // Decode base64url raw RFC 2822
      const rawText = Buffer.from(req.body.raw, 'base64url').toString('utf-8');
      const parsed = parseRawEmail(rawText);
      headers = parsed.headers;
      bodyData = encodeGmailBase64(parsed.body);
      snippet = parsed.body.slice(0, 100);
    } else {
      headers = [
        { name: 'From', value: store.gmail.profile.emailAddress },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Subject', value: '(no subject)' },
        { name: 'Message-ID', value: `<${id}@example.com>` },
      ];
    }

    const msg = {
      id,
      threadId,
      labelIds: ['SENT'],
      snippet,
      historyId: String(store.gmail.nextHistoryId++),
      internalDate: String(now),
      sizeEstimate: bodyData.length,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        filename: '',
        headers,
        body: { size: bodyData.length, data: bodyData },
      },
    };

    store.gmail.messages[id] = msg;
    store.gmail.profile.messagesTotal++;
    store.gmail.profile.threadsTotal++;

    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  // INSERT message
  r.post(`${BASE}/messages`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const threadId = req.body.threadId || generateId();
    const labelIds = req.body.labelIds || ['INBOX'];

    const msg = {
      id,
      threadId,
      labelIds,
      snippet: '',
      historyId: String(store.gmail.nextHistoryId++),
      internalDate: String(Date.now()),
      sizeEstimate: 0,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        filename: '',
        headers: [] as Array<{ name: string; value: string }>,
        body: { size: 0, data: '' },
      },
    };

    if (req.body.raw) {
      const rawText = Buffer.from(req.body.raw, 'base64url').toString('utf-8');
      const parsed = parseRawEmail(rawText);
      msg.payload.headers = parsed.headers;
      msg.payload.body = { size: parsed.body.length, data: encodeGmailBase64(parsed.body) };
      msg.snippet = parsed.body.slice(0, 100);
      msg.sizeEstimate = parsed.body.length;
    }

    store.gmail.messages[id] = msg;
    store.gmail.profile.messagesTotal++;
    store.gmail.profile.threadsTotal++;

    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  // === Media upload endpoints ===
  // Newer gws versions route +send / +reply / +reply-all / +forward through
  // Gmail's /upload/ endpoint instead of the regular /messages/send.
  // Verified against gws 0.16.0 (still uses /messages/send) and 0.22.5
  // (always uses /upload/); the exact cutoff in between was not bisected.
  // Two upload protocols are supported by Gmail:
  //   - uploadType=media     → body is raw RFC822 (Content-Type: message/rfc822)
  //   - uploadType=multipart → multipart/related body with two parts:
  //       1. application/json metadata (e.g. {"threadId":"thread001"})
  //       2. message/rfc822 raw bytes
  // We capture the body as a Buffer regardless of Content-Type and dispatch
  // based on the header below.
  const rawMessageBody = expressRaw({ type: '*/*', limit: '40mb' });

  r.post(`${UPLOAD_BASE}/messages/send`, rawMessageBody, (req, res) => {
    const { rfc822, metadata } = parseUploadBody(req.body, req.headers['content-type']);
    const threadId = metadata.threadId || (req.query.threadId as string | undefined);
    const msg = ingestRawMessage(rfc822, ['SENT'], threadId);
    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  r.post(`${UPLOAD_BASE}/messages`, rawMessageBody, (req, res) => {
    const { rfc822, metadata } = parseUploadBody(req.body, req.headers['content-type']);
    const labelsParam = req.query.labelIds;
    const labels =
      metadata.labelIds ??
      (Array.isArray(labelsParam)
        ? (labelsParam as string[])
        : labelsParam
          ? [labelsParam as string]
          : ['INBOX']);
    const threadId = metadata.threadId || (req.query.threadId as string | undefined);
    const msg = ingestRawMessage(rfc822, labels, threadId);
    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  // DELETE message
  r.delete(`${BASE}/messages/:id`, (req, res) => {
    const store = getStore();
    if (!store.gmail.messages[req.params.id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    delete store.gmail.messages[req.params.id];
    store.gmail.profile.messagesTotal--;
    res.status(204).send();
  });

  // TRASH message
  r.post(`${BASE}/messages/:id/trash`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    msg.labelIds = msg.labelIds.filter(l => l !== 'INBOX');
    if (!msg.labelIds.includes('TRASH')) msg.labelIds.push('TRASH');
    res.json(msg);
  });

  // UNTRASH message
  r.post(`${BASE}/messages/:id/untrash`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    msg.labelIds = msg.labelIds.filter(l => l !== 'TRASH');
    if (!msg.labelIds.includes('INBOX')) msg.labelIds.push('INBOX');
    res.json(msg);
  });

  // MODIFY message labels
  r.post(`${BASE}/messages/:id/modify`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    const { addLabelIds = [], removeLabelIds = [] } = req.body;
    msg.labelIds = msg.labelIds.filter((l: string) => !removeLabelIds.includes(l));
    for (const label of addLabelIds) {
      if (!msg.labelIds.includes(label)) msg.labelIds.push(label);
    }
    res.json(msg);
  });

  // LIST labels
  r.get(`${BASE}/labels`, (_req, res) => {
    res.json({ labels: Object.values(getStore().gmail.labels) });
  });

  // GET label
  r.get(`${BASE}/labels/:id`, (req, res) => {
    const label = getStore().gmail.labels[req.params.id];
    if (!label) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    res.json(label);
  });

  // CREATE label
  r.post(`${BASE}/labels`, (req, res) => {
    const store = getStore();
    const id = `Label_${generateId(8)}`;
    const label = {
      id,
      name: req.body.name || 'Untitled',
      type: 'user' as const,
      messageListVisibility: req.body.messageListVisibility || 'show',
      labelListVisibility: req.body.labelListVisibility || 'labelShow',
    };
    store.gmail.labels[id] = label;
    res.json(label);
  });

  // UPDATE label (PUT - full replace)
  r.put(`${BASE}/labels/:id`, (req, res) => {
    const store = getStore();
    const label = store.gmail.labels[req.params.id];
    if (!label) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    if (label.type === 'system') {
      return res.status(400).json({
        error: { code: 400, message: 'Cannot modify system labels.', status: 'INVALID_ARGUMENT' },
      });
    }
    store.gmail.labels[req.params.id] = { ...req.body, id: label.id, type: label.type };
    res.json(store.gmail.labels[req.params.id]);
  });

  // PATCH label
  r.patch(`${BASE}/labels/:id`, (req, res) => {
    const store = getStore();
    const label = store.gmail.labels[req.params.id];
    if (!label) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    if (label.type === 'system') {
      return res.status(400).json({
        error: { code: 400, message: 'Cannot modify system labels.', status: 'INVALID_ARGUMENT' },
      });
    }
    Object.assign(label, req.body, { id: label.id, type: label.type });
    res.json(label);
  });

  // DELETE label
  r.delete(`${BASE}/labels/:id`, (req, res) => {
    const store = getStore();
    const label = store.gmail.labels[req.params.id];
    if (!label) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    if (label.type === 'system') {
      return res.status(400).json({
        error: { code: 400, message: 'Cannot delete system labels.', status: 'INVALID_ARGUMENT' },
      });
    }
    delete store.gmail.labels[req.params.id];
    res.status(204).send();
  });

  // === Settings ===

  // GET sendAs
  r.get(`${BASE}/settings/sendAs`, (_req, res) => {
    const store = getStore();
    const email = store.gmail.profile.emailAddress;
    res.json({
      sendAs: [
        {
          sendAsEmail: email,
          displayName: 'Test User',
          isDefault: true,
          isPrimary: true,
          treatAsAlias: false,
          verificationStatus: 'accepted',
        },
      ],
    });
  });

  // GET sendAs entry
  r.get(`${BASE}/settings/sendAs/:sendAsEmail`, (req, res) => {
    const store = getStore();
    const email = store.gmail.profile.emailAddress;
    if (req.params.sendAsEmail !== email) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    res.json({
      sendAsEmail: email,
      displayName: 'Test User',
      isDefault: true,
      isPrimary: true,
      treatAsAlias: false,
      verificationStatus: 'accepted',
    });
  });

  // IMPORT message (similar to insert)
  r.post(`${BASE}/messages/import`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const threadId = req.body.threadId || generateId();
    const labelIds = req.body.labelIds || ['INBOX'];

    const msg: any = {
      id,
      threadId,
      labelIds,
      snippet: '',
      historyId: String(store.gmail.nextHistoryId++),
      internalDate: String(Date.now()),
      sizeEstimate: 0,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        filename: '',
        headers: [] as Array<{ name: string; value: string }>,
        body: { size: 0, data: '' },
      },
    };

    if (req.body.raw) {
      const rawText = Buffer.from(req.body.raw, 'base64url').toString('utf-8');
      const parsed = parseRawEmail(rawText);
      msg.payload.headers = parsed.headers;
      msg.payload.body = { size: parsed.body.length, data: encodeGmailBase64(parsed.body) };
      msg.snippet = parsed.body.slice(0, 100);
      msg.sizeEstimate = parsed.body.length;
    }

    store.gmail.messages[id] = msg;
    store.gmail.profile.messagesTotal++;
    store.gmail.profile.threadsTotal++;

    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  // BATCH DELETE messages
  r.post(`${BASE}/messages/batchDelete`, (req, res) => {
    const store = getStore();
    const ids: string[] = req.body.ids || [];
    for (const id of ids) {
      if (store.gmail.messages[id]) {
        delete store.gmail.messages[id];
        store.gmail.profile.messagesTotal--;
      }
    }
    res.status(204).send();
  });

  // BATCH MODIFY messages
  r.post(`${BASE}/messages/batchModify`, (req, res) => {
    const store = getStore();
    const ids: string[] = req.body.ids || [];
    const { addLabelIds = [], removeLabelIds = [] } = req.body;
    for (const id of ids) {
      const msg = store.gmail.messages[id];
      if (msg) {
        msg.labelIds = msg.labelIds.filter((l: string) => !removeLabelIds.includes(l));
        for (const label of addLabelIds) {
          if (!msg.labelIds.includes(label)) msg.labelIds.push(label);
        }
      }
    }
    res.status(204).send();
  });

  // === Attachments ===

  // GET attachment
  r.get(`${BASE}/messages/:messageId/attachments/:id`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.messageId];

    // Try to find real attachment data from message parts
    if (msg?.payload?.parts) {
      for (const part of msg.payload.parts) {
        if (part.body?.attachmentId === req.params.id && part.body?.data) {
          return res.json({
            attachmentId: req.params.id,
            size: part.body.size,
            data: part.body.data,
          });
        }
      }
    }

    // Return fake attachment data as fallback
    const fakeData = encodeGmailBase64('fake attachment content');
    res.json({
      attachmentId: req.params.id,
      size: 23,
      data: fakeData,
    });
  });

  // === Drafts ===

  // LIST drafts
  r.get(`${BASE}/drafts`, (_req, res) => {
    const store = getStore();
    const drafts = Object.values(store.gmail.messages).filter(m => m.labelIds.includes('DRAFT'));
    res.json({
      drafts: drafts.map(m => ({
        id: m.id,
        message: { id: m.id, threadId: m.threadId },
      })),
      resultSizeEstimate: drafts.length,
    });
  });

  // GET draft
  r.get(`${BASE}/drafts/:id`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg || !msg.labelIds.includes('DRAFT')) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    res.json({
      id: msg.id,
      message: msg,
    });
  });

  // CREATE draft
  r.post(`${BASE}/drafts`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const threadId = req.body?.message?.threadId || generateId();
    const labelIds = ['DRAFT'];

    const msg: any = {
      id,
      threadId,
      labelIds,
      snippet: '',
      historyId: String(store.gmail.nextHistoryId++),
      internalDate: String(Date.now()),
      sizeEstimate: 0,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        filename: '',
        headers: [] as Array<{ name: string; value: string }>,
        body: { size: 0, data: '' },
      },
    };

    // Handle multipart upload (message/rfc822) or JSON body
    const raw = req.body?.raw || req.body?.message?.raw;
    if (raw) {
      const rawText = Buffer.from(raw, 'base64url').toString('utf-8');
      const parsed = parseRawEmail(rawText);
      msg.payload.headers = parsed.headers;
      msg.payload.body = { size: parsed.body.length, data: encodeGmailBase64(parsed.body) };
      msg.snippet = parsed.body.slice(0, 100);
      msg.sizeEstimate = parsed.body.length;
    }

    store.gmail.messages[id] = msg;
    store.gmail.profile.messagesTotal++;

    res.json({
      id,
      message: { id, threadId, labelIds },
    });
  });

  // UPDATE draft
  r.put(`${BASE}/drafts/:id`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg || !msg.labelIds.includes('DRAFT')) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }

    const raw = req.body?.raw || req.body?.message?.raw;
    if (raw) {
      const rawText = Buffer.from(raw, 'base64url').toString('utf-8');
      const parsed = parseRawEmail(rawText);
      msg.payload.headers = parsed.headers;
      msg.payload.body = { size: parsed.body.length, data: encodeGmailBase64(parsed.body) };
      msg.snippet = parsed.body.slice(0, 100);
    }

    res.json({
      id: msg.id,
      message: msg,
    });
  });

  // DELETE draft
  r.delete(`${BASE}/drafts/:id`, (req, res) => {
    const store = getStore();
    const msg = store.gmail.messages[req.params.id];
    if (!msg || !msg.labelIds.includes('DRAFT')) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    delete store.gmail.messages[req.params.id];
    store.gmail.profile.messagesTotal--;
    res.status(204).send();
  });

  // SEND draft
  r.post(`${BASE}/drafts/send`, (req, res) => {
    const store = getStore();
    const draftId = req.body?.id;
    const msg = draftId ? store.gmail.messages[draftId] : null;
    if (!msg) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    // Convert draft to sent message
    msg.labelIds = msg.labelIds.filter(l => l !== 'DRAFT');
    msg.labelIds.push('SENT');
    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
  });

  // === History ===

  // LIST history
  r.get(`${BASE}/history`, (req, res) => {
    const store = getStore();
    const startHistoryId = parseInt(req.query.startHistoryId as string) || 0;
    const historyTypes = req.query.historyTypes as string | undefined;

    // Build history from messages with historyId > startHistoryId
    const messages = Object.values(store.gmail.messages)
      .filter(m => parseInt(m.historyId) > startHistoryId);

    const history = messages.map(m => {
      const entry: any = {
        id: m.historyId,
        messages: [{ id: m.id, threadId: m.threadId }],
      };
      if (!historyTypes || historyTypes === 'messageAdded') {
        entry.messagesAdded = [{ message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds } }];
      }
      return entry;
    });

    res.json({
      history,
      historyId: String(store.gmail.nextHistoryId - 1),
    });
  });

  // LIST threads
  r.get(`${BASE}/threads`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages);
    const threadMap = new Map<string, typeof messages>();
    for (const msg of messages) {
      const arr = threadMap.get(msg.threadId) || [];
      arr.push(msg);
      threadMap.set(msg.threadId, arr);
    }

    const threads = Array.from(threadMap.entries()).map(([id, msgs]) => ({
      id,
      snippet: msgs[0].snippet,
      historyId: msgs[msgs.length - 1].historyId,
    }));

    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 500);
    res.json({
      threads: threads.slice(0, maxResults),
      resultSizeEstimate: threads.length,
    });
  });

  // GET thread
  r.get(`${BASE}/threads/:id`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages).filter(m => m.threadId === req.params.id);
    if (messages.length === 0) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    res.json({
      id: req.params.id,
      historyId: messages[messages.length - 1].historyId,
      messages,
    });
  });

  // DELETE thread
  r.delete(`${BASE}/threads/:id`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages).filter(m => m.threadId === req.params.id);
    if (messages.length === 0) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    for (const msg of messages) {
      delete store.gmail.messages[msg.id];
      store.gmail.profile.messagesTotal--;
    }
    store.gmail.profile.threadsTotal--;
    res.status(204).send();
  });

  // TRASH thread
  r.post(`${BASE}/threads/:id/trash`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages).filter(m => m.threadId === req.params.id);
    if (messages.length === 0) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    for (const msg of messages) {
      msg.labelIds = msg.labelIds.filter(l => l !== 'INBOX');
      if (!msg.labelIds.includes('TRASH')) msg.labelIds.push('TRASH');
    }
    res.json({
      id: req.params.id,
      historyId: messages[messages.length - 1].historyId,
      messages,
    });
  });

  // UNTRASH thread
  r.post(`${BASE}/threads/:id/untrash`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages).filter(m => m.threadId === req.params.id);
    if (messages.length === 0) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    for (const msg of messages) {
      msg.labelIds = msg.labelIds.filter(l => l !== 'TRASH');
      if (!msg.labelIds.includes('INBOX')) msg.labelIds.push('INBOX');
    }
    res.json({
      id: req.params.id,
      historyId: messages[messages.length - 1].historyId,
      messages,
    });
  });

  // MODIFY thread labels
  r.post(`${BASE}/threads/:id/modify`, (req, res) => {
    const store = getStore();
    const messages = Object.values(store.gmail.messages).filter(m => m.threadId === req.params.id);
    if (messages.length === 0) {
      return res.status(404).json({
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    }
    const { addLabelIds = [], removeLabelIds = [] } = req.body;
    for (const msg of messages) {
      msg.labelIds = msg.labelIds.filter((l: string) => !removeLabelIds.includes(l));
      for (const label of addLabelIds) {
        if (!msg.labelIds.includes(label)) msg.labelIds.push(label);
      }
    }
    res.json({
      id: req.params.id,
      historyId: messages[messages.length - 1].historyId,
      messages,
    });
  });

  return r;
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function filterByQuery(messages: ReturnType<typeof Object.values<any>>, q: string): any[] {
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")/g) || [];
  return messages.filter((msg: any) => {
    const headers = msg.payload?.headers || [];
    return tokens.every((token: string) => {
      if (token.startsWith('from:')) return getHeader(headers, 'From').toLowerCase().includes(token.slice(5).toLowerCase());
      if (token.startsWith('to:')) return getHeader(headers, 'To').toLowerCase().includes(token.slice(3).toLowerCase());
      if (token.startsWith('subject:')) return getHeader(headers, 'Subject').toLowerCase().includes(token.slice(8).toLowerCase());
      if (token === 'is:unread') return msg.labelIds.includes('UNREAD');
      if (token === 'is:starred') return msg.labelIds.includes('STARRED');
      if (token === 'in:inbox') return msg.labelIds.includes('INBOX');
      if (token === 'in:sent') return msg.labelIds.includes('SENT');
      if (token === 'in:trash') return msg.labelIds.includes('TRASH');
      if (token.startsWith('label:')) return msg.labelIds.includes(token.slice(6));
      // Free text search on snippet and subject
      const text = (msg.snippet + ' ' + getHeader(headers, 'Subject')).toLowerCase();
      return text.includes(token.toLowerCase().replace(/"/g, ''));
    });
  });
}

interface UploadParts {
  /** Raw RFC822 message bytes (or undefined if missing) */
  rfc822: Buffer | undefined;
  /** Parsed JSON metadata part (empty object if absent) */
  metadata: { threadId?: string; labelIds?: string[] };
}

/**
 * Parse a Gmail media-upload request body. Supports both:
 *  - uploadType=media     → body is the raw RFC822 message
 *  - uploadType=multipart → multipart/related with a JSON metadata part and
 *                           a message/rfc822 part
 * Falls back to treating the whole body as RFC822 if the content type doesn't
 * look like multipart.
 */
function parseUploadBody(
  body: Buffer | undefined,
  contentType: string | undefined,
): UploadParts {
  if (!body || body.length === 0) {
    return { rfc822: undefined, metadata: {} };
  }
  const ct = contentType || '';
  const multipartMatch = ct.match(/multipart\/(?:related|mixed|form-data)\s*;\s*boundary=("?)([^";]+)\1/i);
  if (!multipartMatch) {
    return { rfc822: body, metadata: {} };
  }
  const boundary = multipartMatch[2];
  const parts = splitMultipart(body, boundary);

  let rfc822: Buffer | undefined;
  const metadata: UploadParts['metadata'] = {};

  for (const part of parts) {
    const partType = (part.headers['content-type'] || '').toLowerCase();
    if (partType.startsWith('application/json')) {
      try {
        const meta = JSON.parse(part.body.toString('utf-8'));
        if (typeof meta.threadId === 'string') metadata.threadId = meta.threadId;
        if (Array.isArray(meta.labelIds)) metadata.labelIds = meta.labelIds;
      } catch {}
    } else if (partType.startsWith('message/rfc822') || partType.startsWith('message/')) {
      rfc822 = part.body;
    } else if (!rfc822) {
      // Fallback: first non-JSON part is treated as the message
      rfc822 = part.body;
    }
  }
  return { rfc822, metadata };
}

interface MultipartPart {
  headers: Record<string, string>;
  body: Buffer;
}

/** Minimal RFC2046 multipart splitter — enough for Gmail's two-part uploads. */
function splitMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];

  let pos = 0;
  // Find first delimiter
  let next = body.indexOf(delimiter, pos);
  if (next === -1) return parts;
  pos = next + delimiter.length;

  while (pos < body.length) {
    // After the delimiter we expect either CRLF (more parts) or "--" (end)
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // closing "--"
    // Skip the CRLF after the delimiter
    if (body[pos] === 0x0d) pos += 2;
    else if (body[pos] === 0x0a) pos += 1;

    next = body.indexOf(delimiter, pos);
    if (next === -1) break;
    // The part's content goes up to (but not including) the CRLF immediately
    // before the next delimiter.
    let end = next;
    if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    else if (body[end - 1] === 0x0a) end -= 1;

    const partBuf = body.subarray(pos, end);
    parts.push(parsePart(partBuf));
    pos = next + delimiter.length;
  }
  return parts;
}

function parsePart(buf: Buffer): MultipartPart {
  // Find header/body separator: \r\n\r\n or \n\n
  let sep = buf.indexOf(Buffer.from('\r\n\r\n'));
  let sepLen = 4;
  if (sep === -1) {
    sep = buf.indexOf(Buffer.from('\n\n'));
    sepLen = 2;
  }
  if (sep === -1) {
    return { headers: {}, body: buf };
  }
  const headerStr = buf.subarray(0, sep).toString('utf-8');
  const body = buf.subarray(sep + sepLen);
  const headers: Record<string, string> = {};
  for (const line of headerStr.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
    }
  }
  return { headers, body };
}

/**
 * Shared logic for ingesting an RFC822 raw message (from either the JSON
 * `messages.send` body.raw field or the media upload endpoints which post the
 * message bytes directly). Stores the message and returns it.
 */
function ingestRawMessage(
  rawBody: Buffer | string | undefined,
  labelIds: string[],
  threadIdOverride?: string,
) {
  const store = getStore();
  const id = generateId();
  const threadId = threadIdOverride || generateId();
  const now = Date.now();

  let headers: Array<{ name: string; value: string }> = [];
  let bodyData = '';
  let snippet = '';

  if (rawBody && (Buffer.isBuffer(rawBody) ? rawBody.length > 0 : rawBody.length > 0)) {
    const rawText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;
    const parsed = parseRawEmail(rawText);
    headers = parsed.headers;
    bodyData = encodeGmailBase64(parsed.body);
    snippet = parsed.body.slice(0, 100);
  } else {
    headers = [
      { name: 'From', value: store.gmail.profile.emailAddress },
      { name: 'To', value: 'recipient@example.com' },
      { name: 'Subject', value: '(no subject)' },
      { name: 'Message-ID', value: `<${id}@example.com>` },
    ];
  }

  const msg = {
    id,
    threadId,
    labelIds,
    snippet,
    historyId: String(store.gmail.nextHistoryId++),
    internalDate: String(now),
    sizeEstimate: bodyData.length,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      filename: '',
      headers,
      body: { size: bodyData.length, data: bodyData },
    },
  };

  store.gmail.messages[id] = msg;
  store.gmail.profile.messagesTotal++;
  store.gmail.profile.threadsTotal++;
  return msg;
}

function parseRawEmail(raw: string): { headers: Array<{ name: string; value: string }>; body: string } {
  const parts = raw.split(/\r?\n\r?\n/);
  const headerSection = parts[0] || '';
  const body = parts.slice(1).join('\n\n');
  const headers: Array<{ name: string; value: string }> = [];
  for (const line of headerSection.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      headers.push({ name: line.slice(0, colonIdx).trim(), value: line.slice(colonIdx + 1).trim() });
    }
  }
  return { headers, body };
}
