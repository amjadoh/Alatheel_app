import type { FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  setPersistence,
} from "firebase/auth";

async function indexedStorageAvailable(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return false;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = (ok: boolean) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(ok);
      }
    };
    const timer = setTimeout(() => finish(false), 3000);
    try {
      const request = indexedDB.open("alatheel-auth-storage-check", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("check");
      request.onerror = () => finish(false);
      request.onblocked = () => finish(false);
      request.onsuccess = () => {
        const db = request.result;
        if (finished) {
          db.close();
          return;
        }
        try {
          const tx = db.transaction("check", "readwrite");
          tx.objectStore("check").put(true, "available");
          tx.oncomplete = () => {
            db.close();
            finish(true);
          };
          tx.onabort = tx.onerror = () => {
            db.close();
            finish(false);
          };
        } catch {
          db.close();
          finish(false);
        }
      };
    } catch {
      finish(false);
    }
  });
}
function localStorageAvailable() {
  const key = "alatheel.auth.storage-check." + Math.random();
  try {
    localStorage.setItem(key, "yes");
    const ok = localStorage.getItem(key) === "yes";
    localStorage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

// Choose durable storage before accepting any sign-in. Migrate previous LOCAL
// sessions through Firebase's supported persistence hierarchy.
export function createPersistentAuth(app: FirebaseApp) {
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const ready = (async () => {
    const persistence = (await indexedStorageAvailable())
      ? indexedDBLocalPersistence
      : localStorageAvailable()
        ? browserLocalPersistence
        : null;
    if (!persistence) throw new Error("No durable auth storage available");
    await setPersistence(auth, persistence);
  })().catch(() => {
    throw Object.assign(
      new Error(
        "تعذر حفظ جلسة الدخول على الجهاز؛ أعد تشغيل التطبيق وحاول مجددًا",
      ),
      { code: "auth/persistence-unavailable" },
    );
  });
  // Consumers await the same failure; do not silently sign in to memory only.
  void ready.catch(() => {});
  return { auth, ready };
}
