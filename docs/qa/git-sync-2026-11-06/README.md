# Product source synchronization — 6 November 2026

The synchronization includes Chrome 0.3.2, the Electron 0.3.0 preview, the Safari
extension derived from Chrome 0.3.2, and the native macOS 0.1.0/build 5 app. Their source,
build scripts, regression tests, guides and existing QA evidence are included. The two
previously unpushed commits are preserved without rewriting history.

Code checkpoints:

- `1fdbc43`: Chrome, Electron, Safari and shared TypeScript packages.
- `fa04ac5`: native Swift app, assets, tests and background verification.

## Verification

| Check                           | Result                                            | Evidence                                   |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| TypeScript unit/component tests | 665 passed across 95 files                        | [tests.log](tests.log)                     |
| Native Swift tests              | 110 Core + 38 application passed                  | [swift-tests.log](swift-tests.log)         |
| Suspended Drive prototype tests | 4 passed                                          | [prototype-tests.log](prototype-tests.log) |
| ESLint                          | Passed with zero warnings                         | [lint.log](lint.log)                       |
| TypeScript                      | Root and all workspaces passed                    | [typecheck.log](typecheck.log)             |
| Production builds               | Web, Chrome, Electron and Safari extension passed | [builds.log](builds.log)                   |
| Chrome package                  | 10 entry points validated; 18-file ZIP generated  | [builds.log](builds.log)                   |
| Production browser scenarios    | 2 passed against the committed-source package     | [browser-tests.log](browser-tests.log)     |

The initial unrestricted Vitest run overlapped lint/typechecking and hit one five-second
test timeout. The final complete run uses two workers; all 665 tests passed without
changing assertions or increasing timeouts.

Production builds ran in a separate detached checkout with synthetic calendar
configuration and existing dependencies. Installed extension files and the user's native
app were not replaced or restarted. Browser checks used a private headless profile and
synthetic Jira/GitHub responses. Native verification used model/API tests; the earlier
[26-state background render evidence](../native-macos-2026-11-06/README.md) remains the
native layout checkpoint. Its application Swift source is unchanged by this
synchronization; the shared-scene generator received formatting only.

Safari's generated Xcode wrapper and actual Safari/Electron desktop interaction were not
exercised. Existing native live acceptance limits remain listed in the
[native delivery backlog](../../native-macos-delivery-backlog.md).

## Public repository contents

Local secrets, generated bundles/archives, dependency directories and local Safari signing
settings stay outside Git. Source and public examples were checked against known local
credentials and credential patterns. Personal addresses, live account/team identifiers and
private spreadsheet URLs were redacted from historical public documents; the original
local documents are preserved in an ignored backup.

Versions and build commands are listed in the [repository README](../../../README.md).
This checkpoint synchronizes source; it does not publish store builds or GitHub Release
assets.
