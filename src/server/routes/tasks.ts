import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';

export function tasksRoutes(): Router {
  const r = Router();
  const PREFIX = '/tasks/v1';

  // === Task Lists ===

  r.get(`${PREFIX}/users/@me/lists`, (_req, res) => {
    const items = Object.values(getStore().tasks.taskLists);
    res.json({ kind: 'tasks#taskLists', items });
  });

  r.get(`${PREFIX}/users/@me/lists/:tasklist`, (req, res) => {
    const tl = getStore().tasks.taskLists[req.params.tasklist];
    if (!tl) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    res.json(tl);
  });

  r.post(`${PREFIX}/users/@me/lists`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const tl = {
      kind: 'tasks#taskList' as const,
      id,
      title: req.body.title || 'Untitled',
      updated: new Date().toISOString(),
      selfLink: '',
    };
    store.tasks.taskLists[id] = tl;
    store.tasks.tasks[id] = {};
    res.json(tl);
  });

  r.patch(`${PREFIX}/users/@me/lists/:tasklist`, (req, res) => {
    const store = getStore();
    const tl = store.tasks.taskLists[req.params.tasklist];
    if (!tl) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    Object.assign(tl, req.body, { id: tl.id, kind: tl.kind });
    tl.updated = new Date().toISOString();
    res.json(tl);
  });

  r.put(`${PREFIX}/users/@me/lists/:tasklist`, (req, res) => {
    const store = getStore();
    if (!store.tasks.taskLists[req.params.tasklist]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    store.tasks.taskLists[req.params.tasklist] = {
      kind: 'tasks#taskList',
      ...req.body,
      id: req.params.tasklist,
      updated: new Date().toISOString(),
    };
    res.json(store.tasks.taskLists[req.params.tasklist]);
  });

  r.delete(`${PREFIX}/users/@me/lists/:tasklist`, (req, res) => {
    const store = getStore();
    if (!store.tasks.taskLists[req.params.tasklist]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    delete store.tasks.taskLists[req.params.tasklist];
    delete store.tasks.tasks[req.params.tasklist];
    res.status(204).send();
  });

  // === Tasks ===

  r.get(`${PREFIX}/lists/:tasklist/tasks`, (req, res) => {
    const store = getStore();
    const tasksMap = store.tasks.tasks[req.params.tasklist];
    if (!tasksMap) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    let items = Object.values(tasksMap);
    // Filter completed
    if (req.query.showCompleted === 'false') {
      items = items.filter(t => t.status !== 'completed');
    }
    items.sort((a, b) => a.position.localeCompare(b.position));
    res.json({ kind: 'tasks#tasks', items });
  });

  r.get(`${PREFIX}/lists/:tasklist/tasks/:task`, (req, res) => {
    const task = getStore().tasks.tasks[req.params.tasklist]?.[req.params.task];
    if (!task) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    res.json(task);
  });

  r.post(`${PREFIX}/lists/:tasklist/tasks`, (req, res) => {
    const store = getStore();
    if (!store.tasks.tasks[req.params.tasklist]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    const id = generateId();
    const existing = Object.values(store.tasks.tasks[req.params.tasklist]);
    const maxPos = existing.length > 0
      ? Math.max(...existing.map(t => parseInt(t.position) || 0))
      : 0;
    const task = {
      kind: 'tasks#task' as const,
      id,
      title: req.body.title || '',
      updated: new Date().toISOString(),
      selfLink: '',
      status: (req.body.status || 'needsAction') as 'needsAction',
      due: req.body.due,
      notes: req.body.notes,
      parent: req.body.parent,
      position: String(maxPos + 1).padStart(20, '0'),
    };
    store.tasks.tasks[req.params.tasklist][id] = task;
    res.json(task);
  });

  r.patch(`${PREFIX}/lists/:tasklist/tasks/:task`, (req, res) => {
    const store = getStore();
    const task = store.tasks.tasks[req.params.tasklist]?.[req.params.task];
    if (!task) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    Object.assign(task, req.body, { id: task.id, kind: task.kind });
    task.updated = new Date().toISOString();
    if (req.body.status === 'completed' && !task.completed) {
      task.completed = new Date().toISOString();
    }
    res.json(task);
  });

  r.put(`${PREFIX}/lists/:tasklist/tasks/:task`, (req, res) => {
    const store = getStore();
    if (!store.tasks.tasks[req.params.tasklist]?.[req.params.task]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    const task = {
      kind: 'tasks#task' as const,
      ...req.body,
      id: req.params.task,
      updated: new Date().toISOString(),
    };
    store.tasks.tasks[req.params.tasklist][req.params.task] = task;
    res.json(task);
  });

  r.delete(`${PREFIX}/lists/:tasklist/tasks/:task`, (req, res) => {
    const store = getStore();
    if (!store.tasks.tasks[req.params.tasklist]?.[req.params.task]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    delete store.tasks.tasks[req.params.tasklist][req.params.task];
    res.status(204).send();
  });

  // MOVE task
  r.post(`${PREFIX}/lists/:tasklist/tasks/:task/move`, (req, res) => {
    const store = getStore();
    const task = store.tasks.tasks[req.params.tasklist]?.[req.params.task];
    if (!task) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    if (req.query.parent) task.parent = req.query.parent as string;
    task.updated = new Date().toISOString();
    res.json(task);
  });

  // CLEAR completed tasks
  r.post(`${PREFIX}/lists/:tasklist/clear`, (req, res) => {
    const store = getStore();
    const tasksMap = store.tasks.tasks[req.params.tasklist];
    if (!tasksMap) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    for (const [id, task] of Object.entries(tasksMap)) {
      if (task.status === 'completed') {
        delete tasksMap[id];
      }
    }
    res.status(204).send();
  });

  return r;
}
