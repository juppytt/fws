import { Router, type Request, type Response } from 'express';
import { getStore } from '../../store/index.js';
import { generateId, generateEtag } from '../../util/id.js';

export function peopleRoutes(): Router {
  const r = Router();
  const PREFIX = '/v1';

  // Google API uses :action suffix (e.g., people/123:deleteContact)
  // Express can't parse these naturally, so we use wildcard routes

  // === People / Contacts ===

  // CREATE contact
  r.post(`${PREFIX}/people:createContact`, (req, res) => {
    const store = getStore();
    const id = `c${generateId(8)}`;
    const resourceName = `people/${id}`;
    const person = { resourceName, etag: generateEtag(), ...req.body };
    store.people.contacts[resourceName] = person;
    res.json(person);
  });

  // BATCH CREATE contacts
  r.post(`${PREFIX}/people:batchCreateContacts`, (req, res) => {
    const store = getStore();
    const contacts = req.body.contacts || [];
    const createdPeople = contacts.map((c: any) => {
      const id = `c${generateId(8)}`;
      const resourceName = `people/${id}`;
      const person = { resourceName, etag: generateEtag(), ...c.contactPerson };
      store.people.contacts[resourceName] = person;
      return { httpStatusCode: 200, person };
    });
    res.json({ createdPeople });
  });

  // BATCH UPDATE contacts
  r.post(`${PREFIX}/people:batchUpdateContacts`, (req, res) => {
    const store = getStore();
    const contacts = req.body.contacts || {};
    const updateResult: Record<string, any> = {};
    for (const [resourceName, body] of Object.entries(contacts) as [string, any][]) {
      const person = store.people.contacts[resourceName];
      if (person) {
        Object.assign(person, body, { resourceName });
        person.etag = generateEtag();
        updateResult[resourceName] = { httpStatusCode: 200, person };
      }
    }
    res.json({ updateResult });
  });

  // BATCH DELETE contacts
  r.post(`${PREFIX}/people:batchDeleteContacts`, (req, res) => {
    const store = getStore();
    const resourceNames: string[] = req.body.resourceNames || [];
    for (const rn of resourceNames) {
      delete store.people.contacts[rn];
    }
    res.json({});
  });

  // BATCH GET people
  r.get(`${PREFIX}/people:batchGet`, (req, res) => {
    const resourceNames = (Array.isArray(req.query.resourceNames) ? req.query.resourceNames : [req.query.resourceNames]) as string[];
    const store = getStore();
    const responses = resourceNames.filter(Boolean).map(rn => {
      const person = store.people.contacts[rn];
      return person ? { httpStatusCode: 200, person } : { httpStatusCode: 404 };
    });
    res.json({ responses });
  });

  // SEARCH contacts
  r.get(`${PREFIX}/people:searchContacts`, (req, res) => {
    const query = (req.query.query as string || '').toLowerCase();
    const store = getStore();
    const results = Object.values(store.people.contacts).filter(p => {
      const name = p.names?.[0]?.displayName?.toLowerCase() || '';
      const email = p.emailAddresses?.[0]?.value?.toLowerCase() || '';
      return name.includes(query) || email.includes(query);
    });
    res.json({ results: results.map(person => ({ person })) });
  });

  // LIST directory people
  r.get(`${PREFIX}/people:listDirectoryPeople`, (_req, res) => {
    res.json({ people: Object.values(getStore().people.contacts) });
  });

  // SEARCH directory people
  r.get(`${PREFIX}/people:searchDirectoryPeople`, (req, res) => {
    const query = (req.query.query as string || '').toLowerCase();
    const people = Object.values(getStore().people.contacts).filter(p => {
      const name = p.names?.[0]?.displayName?.toLowerCase() || '';
      const email = p.emailAddresses?.[0]?.value?.toLowerCase() || '';
      return name.includes(query) || email.includes(query);
    });
    res.json({ people });
  });

  // LIST connections
  r.get(`${PREFIX}/people/me/connections`, (_req, res) => {
    const connections = Object.values(getStore().people.contacts);
    res.json({ connections, totalPeople: connections.length, totalItems: connections.length });
  });

  // GET person (must be after :action routes)
  r.get(`${PREFIX}/people/:peopleId`, (req, res) => {
    const resourceName = `people/${req.params.peopleId}`;
    const person = getStore().people.contacts[resourceName];
    if (!person) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    res.json(person);
  });

  // UPDATE contact — matches people/123:updateContact
  r.patch(`${PREFIX}/people/:rest`, (req, res) => {
    const peopleId = req.params.rest.replace(/:.*$/, '');
    const resourceName = `people/${peopleId}`;
    const store = getStore();
    const person = store.people.contacts[resourceName];
    if (!person) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    Object.assign(person, req.body, { resourceName });
    person.etag = generateEtag();
    res.json(person);
  });

  // DELETE contact — matches people/123:deleteContact
  r.delete(`${PREFIX}/people/:rest`, (req, res) => {
    const peopleId = req.params.rest.replace(/:.*$/, '');
    const resourceName = `people/${peopleId}`;
    const store = getStore();
    if (!store.people.contacts[resourceName]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    delete store.people.contacts[resourceName];
    res.status(204).send();
  });

  // === Other Contacts ===

  r.get(`${PREFIX}/otherContacts`, (_req, res) => {
    res.json({ otherContacts: [], totalSize: 0 });
  });

  r.get(`${PREFIX}/otherContacts:search`, (_req, res) => {
    res.json({ results: [] });
  });

  r.post(`${PREFIX}/otherContacts/:rest`, (_req, res) => {
    res.json({ resourceName: `people/copied`, etag: generateEtag() });
  });

  // === Contact Groups ===

  r.get(`${PREFIX}/contactGroups:batchGet`, (req, res) => {
    const resourceNames = (Array.isArray(req.query.resourceNames) ? req.query.resourceNames : [req.query.resourceNames]) as string[];
    const store = getStore();
    const responses = resourceNames.filter(Boolean).map(rn => store.people.contactGroups[rn]).filter(Boolean);
    res.json({ responses });
  });

  r.get(`${PREFIX}/contactGroups`, (_req, res) => {
    const groups = Object.values(getStore().people.contactGroups);
    res.json({ contactGroups: groups, totalItems: groups.length });
  });

  r.post(`${PREFIX}/contactGroups`, (req, res) => {
    const store = getStore();
    const id = generateId(8);
    const rn = `contactGroups/${id}`;
    const group = {
      resourceName: rn,
      etag: generateEtag(),
      name: req.body.contactGroup?.name || 'Untitled',
      groupType: 'USER_CONTACT_GROUP' as const,
      memberCount: 0,
    };
    store.people.contactGroups[rn] = group;
    res.json(group);
  });

  r.get(`${PREFIX}/contactGroups/:id`, (req, res) => {
    const rn = `contactGroups/${req.params.id}`;
    const group = getStore().people.contactGroups[rn];
    if (!group) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    res.json(group);
  });

  r.put(`${PREFIX}/contactGroups/:id`, (req, res) => {
    const rn = `contactGroups/${req.params.id}`;
    const store = getStore();
    const group = store.people.contactGroups[rn];
    if (!group) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    if (req.body.contactGroup?.name) group.name = req.body.contactGroup.name;
    group.etag = generateEtag();
    res.json(group);
  });

  r.delete(`${PREFIX}/contactGroups/:id`, (req, res) => {
    const rn = `contactGroups/${req.params.id}`;
    const store = getStore();
    if (!store.people.contactGroups[rn]) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    delete store.people.contactGroups[rn];
    res.status(204).send();
  });

  // MODIFY members
  r.post(`${PREFIX}/contactGroups/:id/members:modify`, (req, res) => {
    const rn = `contactGroups/${req.params.id}`;
    const store = getStore();
    const group = store.people.contactGroups[rn];
    if (!group) {
      return res.status(404).json({ error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });
    }
    const toAdd: string[] = req.body.resourceNamesToAdd || [];
    const toRemove: string[] = req.body.resourceNamesToRemove || [];
    if (!group.memberResourceNames) group.memberResourceNames = [];
    group.memberResourceNames = group.memberResourceNames.filter(m => !toRemove.includes(m));
    for (const m of toAdd) {
      if (!group.memberResourceNames.includes(m)) group.memberResourceNames.push(m);
    }
    group.memberCount = group.memberResourceNames.length;
    res.json({ notFoundResourceNames: [] });
  });

  return r;
}
