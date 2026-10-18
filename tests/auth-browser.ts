// Browser-only fixture. All remote traffic is intercepted by auth-continuity-check.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { createPersistentAuth } from "../src/persistent-auth";
import { authFailureAction } from "../src/auth-recovery";
const app = initializeApp({
  apiKey: "qa-not-a-real-key",
  projectId: "demo-alatheel-auth",
  authDomain: "demo-alatheel-auth.invalid",
  appId: "qa-auth-continuity",
});
const legacy = new URLSearchParams(location.search).get("legacy") === "1";
const client = legacy
  ? { auth: getAuth(app), ready: Promise.resolve() }
  : createPersistentAuth(app);
const { auth } = client;
const qa: any = { state: "starting", uid: null };
(window as any).__authQA = qa;
client.ready
  .then(() => auth.authStateReady())
  .then(() => {
    qa.state = "ready";
    qa.uid = auth.currentUser?.uid || null;
  })
  .catch((e) => {
    qa.state = "blocked";
    qa.error = e.code;
  });
qa.signIn = async () => {
  await client.ready;
  await signInWithCredential(
    auth,
    GoogleAuthProvider.credential("isolated-google-fixture"),
  );
  qa.uid = auth.currentUser?.uid;
};
qa.forceLegacyLocal = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return "accepted";
  } catch {
    return "failed";
  }
};
qa.refresh = async () => {
  try {
    await auth.currentUser!.getIdToken(true);
    return "refreshed";
  } catch (e) {
    return authFailureAction(e);
  }
};
qa.snapshot = () => ({ uid: auth.currentUser?.uid || null, state: qa.state });
qa.signOut = async () => {
  await signOut(auth);
  qa.uid = null;
};
