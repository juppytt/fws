import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';

const BASE = '/gmail/v1/users/:userId';

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
      bodyData = Buffer.from(parsed.body).toString('base64url');
      snippet = parsed.body.slice(0, 100);
    } else {
      headers = [
        { name: 'From', value: store.gmail.profile.emailAddress },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Subject', value: '(no subject)' },
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
      msg.payload.body = { size: parsed.body.length, data: Buffer.from(parsed.body).toString('base64url') };
      msg.snippet = parsed.body.slice(0, 100);
      msg.sizeEstimate = parsed.body.length;
    }

    store.gmail.messages[id] = msg;
    store.gmail.profile.messagesTotal++;
    store.gmail.profile.threadsTotal++;

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
      msg.payload.body = { size: parsed.body.length, data: Buffer.from(parsed.body).toString('base64url') };
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
    const fakeData = Buffer.from('fake attachment content').toString('base64url');
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
      msg.payload.body = { size: parsed.body.length, data: Buffer.from(parsed.body).toString('base64url') };
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
      msg.payload.body = { size: parsed.body.length, data: Buffer.from(parsed.body).toString('base64url') };
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
