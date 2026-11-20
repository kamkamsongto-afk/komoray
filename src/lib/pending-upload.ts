// A video dropped on the home page before signing in (coach 20 Nov): kept in this browser while Google signs the
// person in, then /upload?pending=1 takes it and uploads it. It never leaves the computer until then.
// Any failure (private window, a file too big for the browser to keep) just means they pick the file again.
const DB = "komoray";
const STORE = "pending";
const KEY = "video";

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const req = act(tx.objectStore(STORE));
				tx.oncomplete = () => {
					db.close();
					resolve(req.result);
				};
				tx.onerror = tx.onabort = () => {
					db.close();
					reject(tx.error);
				};
			}),
	);
}

export async function keepPending(file: File): Promise<boolean> {
	try {
		await run("readwrite", (s) => s.put(file, KEY));
		return true;
	} catch {
		return false;
	}
}

// The kept video, once: it is gone from the browser after this.
export async function takePending(): Promise<File | null> {
	try {
		const file = await run<unknown>("readonly", (s) => s.get(KEY));
		await run("readwrite", (s) => s.delete(KEY));
		return file instanceof File ? file : file instanceof Blob ? new File([file], "video.mp4", { type: file.type }) : null;
	} catch {
		return null;
	}
}
