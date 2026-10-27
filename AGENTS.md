# Release verification

The user requires that releases are withheld until the changed workflows work and financial checks pass. A successful build alone is insufficient.

## Repository workflow

- These rules are mandatory for every agent working on this repository. The absence of server-side branch protection is never permission to bypass them; the current GitHub plan cannot enforce branch protection on this private repository.
- Never edit or push directly on `main`. If the checkout is on `main`, create or switch to a dedicated feature branch before changing files.
- Push only the feature branch, then open or update its pull request targeting `main`.
- Do not merge a pull request until the complete `Android APK` workflow has passed for the pull request's latest commit. A passing post-merge run is not a substitute for pre-merge verification.
- Do not merge automatically. Leave the tested pull request open until the repository owner explicitly approves the merge.
- Keep `main` releasable. Do not bypass, disable, or weaken required checks to merge a change.

## Update channels

- `Official` is the default and only update channel for every account except the primary stable manager.
- Only the primary stable manager may see or select `Bata`; do not expose it to other administrators, employees, owners, or viewers.
- Keep the `Official` and `Bata` manifests and APK paths isolated. Never publish a beta build through the official manifest.

- Verify accounts, partial payments, advance credit, arrears, expense recovery, actual cash totals, inventory purchase idempotency, and closed-month preservation.
- Run unit tests, app and function builds, mobile UI checks, and Android build/start checks before publishing. State any device or authentication testing gaps honestly.
- Never enable automatic publishing after a build. Verify the exact source commit and signed APK identity before manually releasing or activating latest.json.
- Use isolated fixtures for tests. Do not create production receipts, payments, purchases, members, or invitations for QA.
- Keep the approved Arabic release notes in RTL order: account, home page, horses, inventory, collection, expenses. Dismiss them with ×, once per version.
