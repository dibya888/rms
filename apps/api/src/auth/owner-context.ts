import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

export const ownerContext = {
  run<T>(ownerId: string, callback: () => T) {
    return storage.run(ownerId, callback);
  },
  enter(ownerId: string) {
    storage.enterWith(ownerId);
  },
  get() {
    return storage.getStore();
  },
};
