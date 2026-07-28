import type { FwsStore } from './types.js';
import { createSeedStore } from './seed.js';

let store: FwsStore = createSeedStore();

export function getStore(): FwsStore {
  return store;
}

export function resetStore(): void {
  store = createSeedStore();
}

export function loadStore(data: FwsStore): void {
  store = {
    ...data,
    // Keep snapshots from releases before custom services loadable.
    customServices: data.customServices ?? { services: {} },
  };
}

export function serializeStore(): string {
  return JSON.stringify(store, null, 2);
}

export function deserializeStore(json: string): FwsStore {
  return JSON.parse(json) as FwsStore;
}
