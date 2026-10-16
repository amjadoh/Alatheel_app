# Release verification

The user requires that releases are withheld until the changed workflows work and financial checks pass. A successful build alone is insufficient.

- Verify accounts, partial payments, advance credit, arrears, expense recovery, actual cash totals, inventory purchase idempotency, and closed-month preservation.
- Run unit tests, app and function builds, mobile UI checks, and Android build/start checks before publishing. State any device or authentication testing gaps honestly.
- Never enable automatic publishing after a build. Verify the exact source commit and signed APK identity before manually releasing or activating latest.json.
- Use isolated fixtures for tests. Do not create production receipts, payments, purchases, members, or invitations for QA.
- Keep the approved Arabic release notes in RTL order: account, home page, horses, inventory, collection, expenses. Dismiss them with ×, once per version.
