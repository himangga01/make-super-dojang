// 보관함: 만든 서명·도장을 이 브라우저(IndexedDB)에 저장한다. 서버로 보내지 않는다.

const DB_NAME = 'super-dojang';
const STORE = 'items';
const MAX_ITEMS = 60;

let dbPromise = null;

function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('이 브라우저는 보관함을 지원하지 않아요.'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const result = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(result?.result ?? result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('저장 공간이 부족해요.'));
      }),
  );
}

/** @returns {Promise<Array<{id:string, kind:string, name:string, label:string, blob:Blob, createdAt:number}>>} 최신순 */
export async function listItems() {
  const items = await tx('readonly', (s) => s.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addItem({ kind, name, label, blob }) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, name, label, blob, createdAt: Date.now() };
  await tx('readwrite', (s) => s.put(item));
  // 오래된 항목부터 정리해 너무 커지지 않게 한다
  const all = await listItems();
  if (all.length > MAX_ITEMS) {
    await tx('readwrite', (s) => all.slice(MAX_ITEMS).forEach((it) => s.delete(it.id)));
  }
  return item;
}

export function removeItem(id) {
  return tx('readwrite', (s) => s.delete(id));
}
