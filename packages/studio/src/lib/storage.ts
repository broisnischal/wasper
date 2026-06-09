const DB_NAME = 'openapi-studio-v1';
const DB_VERSION = 2;
let _db: IDBDatabase | null = null;

const hasIDB = typeof globalThis !== 'undefined' && typeof (globalThis as Record<string, unknown>)['indexedDB'] !== 'undefined';

function open(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = (globalThis as Record<string, unknown>)['indexedDB'] as IDBFactory;
    const r = req.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('environments')) db.createObjectStore('environments', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cookies')) db.createObjectStore('cookies', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('explorer')) db.createObjectStore('explorer', { keyPath: 'id' });
    };
    r.onsuccess = e => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    r.onerror = () => reject(r.error);
  });
}

export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  if (!hasIDB) return undefined;
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => res(req.result as T | undefined);
    req.onerror = () => rej(req.error);
  });
}

export async function dbPut(store: string, value: object): Promise<void> {
  if (!hasIDB) return;
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  if (!hasIDB) return [];
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result as T[]);
    req.onerror = () => rej(req.error);
  });
}

export async function dbDel(store: string, key: string): Promise<void> {
  if (!hasIDB) return;
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
