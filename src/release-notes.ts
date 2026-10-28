export const RELEASE_VERSION = "1.12.2";
export const RELEASE_NOTES = [
  {
    title: "تحسينات عامة",
    items: ["تم معالجة وتحسين بعض الإجراءات"],
  },
];
const key = "alatheel.release.read." + RELEASE_VERSION;
type Store = Pick<Storage, "getItem" | "setItem">;
let readInSession = false;
export function needsReleaseNotes(store: Store) {
  try {
    return !readInSession && store.getItem(key) !== "yes";
  } catch {
    return !readInSession;
  }
}
export function markReleaseNotesRead(store: Store) {
  readInSession = true;
  try {
    store.setItem(key, "yes");
  } catch {
    /* Retain dismissal in this session if device storage is unavailable. */
  }
}
