# Release

`pnpm build` creates and validates:

- the unpacked Manifest V3 extension in `dist/extension`;
- `dist/power-view-for-jira-<version>.zip`;
- a matching `.zip.sha256` checksum.

The ZIP writer sorts file paths, uses fixed ZIP timestamps, and stores the exact validated
build bytes, so identical inputs produce identical archives.

## Release checklist

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
3. Run `pnpm build` and `pnpm test:e2e`.
4. Verify the printed SHA-256 against the generated `.sha256` file.
5. Load `dist/extension` unpacked and complete the manual Cloud/Data Center smoke matrix
   in `docs/testing.md`.
6. Review `docs/security-review.md` and confirm no permission or endpoint expansion.
7. Upload the ZIP to the Chrome Web Store owner account, complete store metadata/privacy
   declarations, and submit it for review.

CI uploads the ZIP and checksum as a build artifact. Chrome Web Store signing,
publication, staged rollout, and rollback are owner-controlled actions and are
intentionally not automated.
