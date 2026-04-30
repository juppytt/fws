import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSeedStore, resolveSeedIdentity } from '../src/store/seed.js';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('seed identity (initial values from env)', () => {
  it('uses the testuser defaults when no env vars are set', () => {
    const store = createSeedStore(resolveSeedIdentity({}));
    expect(store.github.user.login).toBe('testuser');
    expect(store.github.user.name).toBe('Test User');
    expect(store.github.user.email).toBe('testuser@example.com');
    expect(store.github.repos['testuser/my-project']).toBeDefined();
    expect(store.gmail.profile.emailAddress).toBe('testuser@example.com');
    expect(store.gmail.profile.displayName).toBe('Test User');
  });

  it('lets FWS_USER_LOGIN / NAME / EMAIL set the initial seeded user', () => {
    const store = createSeedStore(resolveSeedIdentity({
      FWS_USER_LOGIN: 'alex.park',
      FWS_USER_NAME: 'Alex Park',
      FWS_USER_EMAIL: 'alex.park@platform.internal',
    }));
    expect(store.github.user.login).toBe('alex.park');
    expect(store.github.user.name).toBe('Alex Park');
    expect(store.github.user.email).toBe('alex.park@platform.internal');
    expect(store.github.user.html_url).toBe('https://github.com/alex.park');

    // Repo full_name follows the configured login. We don't take a separate
    // repo override — to use a different repo, create one at runtime.
    expect(store.github.repos['alex.park/my-project']).toBeDefined();
    expect(store.github.repos['testuser/my-project']).toBeUndefined();
    expect(store.github.pulls['alex.park/my-project'][3].head.label)
      .toBe('alex.park:fix/sso-login');

    // Other services share the identity.
    expect(store.gmail.profile.emailAddress).toBe('alex.park@platform.internal');
    expect(store.gmail.profile.displayName).toBe('Alex Park');
    const driveOwner = Object.values(store.drive.files)[0].owners?.[0];
    expect(driveOwner?.emailAddress).toBe('alex.park@platform.internal');
    expect(driveOwner?.displayName).toBe('Alex Park');
  });
});

describe('runtime user-set endpoint', () => {
  let h: TestHarness;
  beforeAll(async () => { h = await createTestHarness(); });
  afterAll(async () => { await h.cleanup(); });

  it('alternating user.login between create calls stamps each issue with the right author', async () => {
    // Switch to alex.park and create issue A.
    await h.fetch('/__fws/setup/github/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'alex.park', name: 'Alex Park' }),
    });
    const a = await (await h.fetch('/repos/testuser/my-project/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Issue A', body: 'from alex' }),
    })).json();
    expect(a.user.login).toBe('alex.park');

    // Switch to david.kim and create issue B.
    await h.fetch('/__fws/setup/github/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'david.kim', name: 'David Kim' }),
    });
    const b = await (await h.fetch('/repos/testuser/my-project/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Issue B', body: 'from david' }),
    })).json();
    expect(b.user.login).toBe('david.kim');

    // GET /user reflects the latest set.
    const me = await (await h.fetch('/user')).json();
    expect(me.login).toBe('david.kim');
    expect(me.name).toBe('David Kim');

    // Display name flows to Gmail sendAs / Drive owner without restart.
    const sendAs = await (await h.fetch('/gmail/v1/users/me/settings/sendAs')).json();
    expect(sendAs.sendAs[0].displayName).toBe('David Kim');
  });

  it('partial updates only touch the fields provided', async () => {
    await h.fetch('/__fws/setup/github/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'alex.park', name: 'Alex Park', email: 'alex@x.io' }),
    });
    // Only update email.
    await h.fetch('/__fws/setup/github/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex.park@platform.internal' }),
    });
    const me = await (await h.fetch('/user')).json();
    expect(me.login).toBe('alex.park');
    expect(me.name).toBe('Alex Park');
    expect(me.email).toBe('alex.park@platform.internal');
  });
});
