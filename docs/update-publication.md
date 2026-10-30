# Immediate update announcements

This changes publication operations, not the Android application. Existing apps
already receive update notifications. No new APK or Cloud Function deployment is
needed to activate this procedure.

After explicit release approval and the complete release gate in AGENTS.md:

1. Prepare `downloads-hosting` with all currently published files, including the
   other channel and old APKs. Verify the signed candidate's identity and SHA-256.
2. Run `node scripts/update-manifest.mjs <verified-signed.apk> stable` (or `beta`).
3. Run `node scripts/publish-update.mjs stable` (or `beta`). It checks that previous
   Hosting files are preserved, deploys Hosting, then downloads the live manifest,
   immutable APK and latest APK and verifies their identities, size and SHA-256.
4. Only after those checks succeed, it runs the existing Cloud Scheduler job
   `firebase-schedule-discoverAppUpdates-us-central1` immediately and waits for the
   exact version/channel/hash to appear in `appUpdateState`.

The CLI uses the Firebase CLI's signed-in account, with no tokens in arguments or
source. By default it uses the existing local Firebase CLI package at
`.release/firebase-cli/node_modules/firebase-tools`; `FIREBASE_TOOLS_ROOT` may name
another installed firebase-tools package directory. Use Node22. On hosts requiring
the Windows system certificate store, set `NODE_USE_SYSTEM_CA=1`. The account needs
Hosting deployment, Firestore read and Cloud Scheduler job-run permissions.

If Hosting is already published, or the announcement request/confirmation failed,
run `node scripts/publish-update.mjs stable --announce-only`. This re-verifies live
files, does not redeploy Hosting, and skips the request if that exact release was
already announced. Never increment the app version or reset announcement records
to force a repeated notification.

The worker's existing Firestore transaction prevents duplicate announcements,
including races with the hourly fallback. Its existing recipient policy keeps
Bata limited to the primary manager, and its device filter skips installations
already on the announced version. The scheduled hourly check remains a recovery
path, not the normal publication path. GitHub's draft-release workflow does not
activate Hosting or send announcements.

Confirmation means the announcement was created on the server. FCM acceptance,
Android notification permission, device connectivity and physical display remain
separate delivery stages; do not promise instant display on every handset.
