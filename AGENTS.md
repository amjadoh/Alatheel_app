# Repository workflow

These rules are mandatory for every human or automated agent working on this repository.

- Never commit or push changes directly to `main`.
- Create a dedicated feature branch and open or update a pull request for every repository change.
- Run the pull-request checks and do not merge until every required check passes. Diagnose failures, fix the branch when needed, and rerun failed checks before merging.
- Keep release and deployment steps manual after verification.

# Update channels

- `Official` is the default stable update channel and continues to use `latest.json`.
- `Bata` is the opt-in beta channel and uses `beta/latest.json` with APK files under `downloads/beta/`.

# Release verification

The user requires that releases are withheld until the changed workflows work and financial checks pass. A successful build alone is insufficient.

- Verify accounts, partial payments, advance credit, arrears, expense recovery, actual cash totals, inventory purchase idempotency, and closed-month preservation.
- Run unit tests, app and function builds, mobile UI checks, and Android build/start checks before publishing. State any device or authentication testing gaps honestly.
- Never enable automatic publishing after a build. Verify the exact source commit and signed APK identity before manually releasing or activating latest.json.
- Use isolated fixtures for tests. Do not create production receipts, payments, purchases, members, or invitations for QA.
- Keep the approved Arabic release notes in RTL order: account, home page, horses, inventory, collection, expenses. Dismiss them with ×, once per version.
