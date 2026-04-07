import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';

export function driveRoutes(): Router {
  const r = Router();
  const PREFIX = '/drive/v3';

  // GET about
  r.get(`${PREFIX}/about`, (_req, res) => {
    const store = getStore();
    const userEmail = store.gmail.profile.emailAddress;
    res.json({
      kind: 'drive#about',
      user: {
        displayName: 'Test User',
        emailAddress: userEmail,
        kind: 'drive#user',
        me: true,
      },
      storageQuota: {
        limit: '16106127360',
        usage: '0',
        usageInDrive: '0',
        usageInDriveTrash: '0',
      },
    });
  });

  // LIST files
  r.get(`${PREFIX}/files`, (req, res) => {
    const store = getStore();
    let files = Object.values(store.drive.files);

    // Filter by q
    const q = req.query.q as string | undefined;
    if (q) {
      files = filterDriveQuery(files, q);
    }

    // Default: hide trashed
    if (!q || !q.includes('trashed')) {
      files = files.filter(f => !f.trashed);
    }

    // Sort
    const orderBy = req.query.orderBy as string | undefined;
    if (orderBy) {
      const [field, dir] = orderBy.split(' ');
      const desc = dir === 'desc';
      files.sort((a: any, b: any) => {
        const av = a[field] || '';
        const bv = b[field] || '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return desc ? -cmp : cmp;
      });
    }

    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 100, 1000);
    files = files.slice(0, pageSize);

    res.json({
      kind: 'drive#fileList',
      files: files.map(f => ({
        kind: f.kind,
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
      })),
      incompleteSearch: false,
    });
  });

  // CREATE file
  r.post(`${PREFIX}/files`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const now = new Date().toISOString();
    const userEmail = store.gmail.profile.emailAddress;

    const file = {
      kind: 'drive#file' as const,
      id,
      name: req.body.name || 'Untitled',
      mimeType: req.body.mimeType || 'application/octet-stream',
      parents: req.body.parents || ['root'],
      createdTime: now,
      modifiedTime: now,
      size: req.body.size,
      trashed: false,
      starred: req.body.starred || false,
      owners: [{ emailAddress: userEmail, displayName: 'Test User' }],
      description: req.body.description,
    };

    store.drive.files[id] = file;
    res.json(file);
  });

  // GET file
  r.get(`${PREFIX}/files/:fileId`, (req, res) => {
    const file = getStore().drive.files[req.params.fileId];
    if (!file) {
      return res.status(404).json({
        error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' },
      });
    }
    res.json(file);
  });

  // PATCH file
  r.patch(`${PREFIX}/files/:fileId`, (req, res) => {
    const store = getStore();
    const file = store.drive.files[req.params.fileId];
    if (!file) {
      return res.status(404).json({
        error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' },
      });
    }
    Object.assign(file, req.body, { id: file.id, kind: file.kind });
    file.modifiedTime = new Date().toISOString();
    res.json(file);
  });

  // DELETE file
  r.delete(`${PREFIX}/files/:fileId`, (req, res) => {
    const store = getStore();
    if (!store.drive.files[req.params.fileId]) {
      return res.status(404).json({
        error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' },
      });
    }
    delete store.drive.files[req.params.fileId];
    res.status(204).send();
  });

  // COPY file
  r.post(`${PREFIX}/files/:fileId/copy`, (req, res) => {
    const store = getStore();
    const original = store.drive.files[req.params.fileId];
    if (!original) {
      return res.status(404).json({
        error: { code: 404, message: 'File not found.', status: 'NOT_FOUND' },
      });
    }

    const id = generateId();
    const now = new Date().toISOString();
    const copy = {
      ...original,
      id,
      name: req.body.name || `Copy of ${original.name}`,
      parents: req.body.parents || original.parents,
      createdTime: now,
      modifiedTime: now,
    };
    store.drive.files[id] = copy;
    res.json(copy);
  });

  return r;
}

function filterDriveQuery(files: any[], q: string): any[] {
  // Simple query parser for common Drive query patterns
  const conditions = q.split(/\s+and\s+/i);
  return files.filter(f => {
    return conditions.every(cond => {
      cond = cond.trim();

      // name = 'X'
      let match = cond.match(/^name\s*=\s*'([^']+)'$/);
      if (match) return f.name === match[1];

      // name contains 'X'
      match = cond.match(/^name\s+contains\s+'([^']+)'$/i);
      if (match) return f.name.toLowerCase().includes(match[1].toLowerCase());

      // mimeType = 'X'
      match = cond.match(/^mimeType\s*=\s*'([^']+)'$/);
      if (match) return f.mimeType === match[1];

      // 'parentId' in parents
      match = cond.match(/^'([^']+)'\s+in\s+parents$/);
      if (match) return f.parents?.includes(match[1]);

      // trashed = true/false
      match = cond.match(/^trashed\s*=\s*(true|false)$/);
      if (match) return f.trashed === (match[1] === 'true');

      return true; // unknown conditions pass through
    });
  });
}
