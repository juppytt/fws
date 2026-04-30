import { describe, it, expect } from 'vitest';
import { createSeedStore, resolveSeedIdentity } from '../src/store/seed.js';

describe('seed identity overrides', () => {
  it('uses the testuser defaults when no env vars are set', () => {
    const store = createSeedStore(resolveSeedIdentity({}));
    expect(store.github.user.login).toBe('testuser');
    expect(store.github.user.name).toBe('Test User');
    expect(store.github.user.email).toBe('testuser@example.com');
    expect(store.github.repos['testuser/my-project']).toBeDefined();
    expect(store.gmail.profile.emailAddress).toBe('testuser@example.com');
    expect(store.gmail.profile.displayName).toBe('Test User');
  });

  it('lets FWS_USER_LOGIN / NAME / EMAIL override the seeded user', () => {
    const store = createSeedStore(resolveSeedIdentity({
      FWS_USER_LOGIN: 'alex.park',
      FWS_USER_NAME: 'Alex Park',
      FWS_USER_EMAIL: 'alex.park@platform.internal',
    }));
    expect(store.github.user.login).toBe('alex.park');
    expect(store.github.user.name).toBe('Alex Park');
    expect(store.github.user.email).toBe('alex.park@platform.internal');
    expect(store.github.user.html_url).toBe('https://github.com/alex.park');

    // The seeded repo follows the login by default, and so do the issue /
    // PR / comment references — that's the bit the agent reads.
    expect(store.github.repos['alex.park/my-project']).toBeDefined();
    expect(store.github.repos['testuser/my-project']).toBeUndefined();
    expect(store.github.pulls['alex.park/my-project'][3].head.label)
      .toBe('alex.park:fix/sso-login');
    expect(store.github.issues['alex.park/my-project'][1].assignees[0].login)
      .toBe('alex.park');

    // Other services share the identity.
    expect(store.gmail.profile.emailAddress).toBe('alex.park@platform.internal');
    expect(store.gmail.profile.displayName).toBe('Alex Park');
    const driveOwner = Object.values(store.drive.files)[0].owners?.[0];
    expect(driveOwner?.emailAddress).toBe('alex.park@platform.internal');
    expect(driveOwner?.displayName).toBe('Alex Park');
  });

  it('FWS_GITHUB_REPO accepts owner/repo for non-personal owners', () => {
    const store = createSeedStore(resolveSeedIdentity({
      FWS_USER_LOGIN: 'alex.park',
      FWS_GITHUB_REPO: 'platform/weather-outfit-recommender',
    }));
    expect(store.github.user.login).toBe('alex.park');
    const repo = store.github.repos['platform/weather-outfit-recommender'];
    expect(repo).toBeDefined();
    expect(repo.owner.login).toBe('platform');
    expect(repo.html_url).toBe('https://github.com/platform/weather-outfit-recommender');
    expect(store.github.issues['platform/weather-outfit-recommender'][1].html_url)
      .toBe('https://github.com/platform/weather-outfit-recommender/issues/1');
  });

  it('FWS_GITHUB_REPO without a slash keeps the owner = login', () => {
    const store = createSeedStore(resolveSeedIdentity({
      FWS_USER_LOGIN: 'alex.park',
      FWS_GITHUB_REPO: 'weather-outfit-recommender',
    }));
    expect(store.github.repos['alex.park/weather-outfit-recommender']).toBeDefined();
  });
});
