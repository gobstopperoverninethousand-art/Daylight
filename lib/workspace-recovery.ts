// Recovery snapshots can outgrow localStorage. Archive them before freeing space.
async function archive(entries: [string, string][]) {
  if (!entries.length) return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("daylight-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("copies");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("copies", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      const copies = transaction.objectStore("copies");
      for (const [key, value] of entries) copies.put(value, key);
    });
  } finally {
    db.close();
  }
}

export async function migrateRecoveryCopies() {
  const entries: [string, string][] = [];
  for (const key of Object.keys(localStorage)) {
    if (!/^daylight:recovery:\d+$/.test(key)) continue;
    const copy = localStorage.getItem(key);
    if (copy !== null) entries.push([key, copy]);
  }
  await archive(entries);
  for (const [key, copy] of entries) {
    if (localStorage.getItem(key) === copy) localStorage.removeItem(key);
  }
}

export function archiveRecoveryCopy(workspace: string, copy: string) {
  return archive([[workspace + ":" + crypto.randomUUID(), copy]]);
}
