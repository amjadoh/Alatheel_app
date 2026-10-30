# Firebase feedback synchronization

Submitted feedback stays in the private `amjadoh/Alatheel_app` repository. A Firestore update on the named application database invokes `syncAppFeedback` when submission or manual retry assigns a new `syncRequestId`. No periodic polling is required. Existing app versions use the same callable API and need no APK update.

The worker reconstructs and verifies attachment chunks, preserves the existing `app-feedback/reports/<id>` paths, and reconciles the existing issue marker before creating an issue. Exact binary contents are never overwritten. Legacy note JSON may differ in field order/formatting but must be semantically identical. Stored fields are restricted to the feedback payload; application business records are not exported.

Retries use Eventarc delivery of the original submission event, not new status-change events. A transactional ten-minute lease exceeds the nine-minute function timeout. Attempts stop after five export attempts or an event age of 24 hours and display `failed`, allowing an explicit retry from the app. Old events cannot process a newer request. A successful export stores the issue URL and sets `emailState: disabled`; it does not trigger SMTP email. GitHub's normal issue notifications still follow the recipient's own GitHub settings.

## Activation requirements

1. Complete the PR `Android APK` checks or the complete local equivalent defined in `AGENTS.md` before merging. Record evidence against the latest PR commit. GitHub billing restrictions do not waive any validation stage.
2. Create a dedicated fine-grained GitHub token limited to `amjadoh/Alatheel_app` with **Contents: read/write** and **Issues: read/write** (Metadata read is implicit). Store it as `FEEDBACK_GITHUB_TOKEN` in Firebase Secret Manager for project `gen-lang-client-0145196991`. Use a secure local prompt or the Google console, never chat, source control, the APK, or logs. Do not reuse the workstation's general Git credential. Track expiry and rotate before expiration.
3. Build functions and deploy `functions:syncAppFeedback,functions:appFeedback,functions:feedbackBridge` from the approved commit. The trigger must target database `ai-studio-3316cd3a-14d1-4f71-adec-897324c5bb0e`, with `minInstances: 0`, one instance, and concurrency one. Confirm runtime access to this secret and Eventarc delivery permissions.
4. Keep the old Actions workflow disabled. Its cron is removed; manual dispatch remains for legacy recovery only. It skips all notes with `syncRequestId`, avoiding competition with Firebase.
5. Existing queued/uploading notes do not emit a new event merely because a trigger was deployed. Review their state/lease and issue archive, then migrate pending notes by assigning a new `syncRequestId` and resetting expired leases in a transaction. Never requeue synced notes. Preserve failed notes for explicit retry. Do not silently declare the backlog migrated.
6. Verify a user-submitted note and attachment end to end after activation: one issue, intact bytes, visible synced state, no SMTP mail. Until this check succeeds, report deployment/authentication verification as pending. Use only isolated fixtures for automated tests.

Firestore access, Eventarc delivery, function execution, Secret Manager, deployment storage and network transfer may be billable. Five attempts limit export work per request; they are not a monetary spending cap.

## Issue status synchronization

Primary-manager status changes queue a separate `statusRequestId`. The same
Firestore worker closes `resolved` issues with `state_reason: completed`, and
reopens `new`/`discussion` issues. It first validates the repository URL, issue
number, non-PR type and feedback marker. It does not create issues, comments or
attachment commits for status changes, and skips PATCH when the desired state is
already present. Independent leases, request generations, five-attempt/24-hour
bounds and safe failures protect retries and superseded requests. SMTP remains
disabled; GitHub's own normal notifications still follow account settings.

Statuses queued before initial export wait for that issue to exist. Export
completion wakes pending status work. Old already-exported notes do not emit an
event on deployment: the primary manager can use “مزامنة حالة GitHub” to reconcile
their saved status, or change status normally. Failed status sync exposes the same
retry button without re-uploading attachments. This is app-to-GitHub synchronization;
manual GitHub state edits are not imported back into the app.
