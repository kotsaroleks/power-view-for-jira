# Power View for Jira

Power View for Jira provides Jira planning, reporting, time tracking and estimation. This
repository contains the Chrome extension, a native macOS application, and desktop and
Safari previews.

## Product versions

| Variant                      | Current version            | Build                                | Guide                                                 |
| ---------------------------- | -------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Chrome extension             | 0.3.2                      | `pnpm build`                         | [Install the extension](#load-the-unpacked-extension) |
| Native macOS, SwiftUI/AppKit | 0.1.0, build 6             | `sh scripts/package-native-macos.sh` | [Native app](apps/macos/README.md)                    |
| Electron desktop preview     | 0.3.0                      | `pnpm build:desktop`                 | [Desktop preview](docs/desktop.md)                    |
| Safari web extension preview | 0.3.2, derived from Chrome | `pnpm build:safari`                  | [Safari preview](docs/safari.md)                      |

These variants have separate version numbers and acceptance limits. The native app is
implemented in SwiftUI/AppKit. The Electron preview hosts the shared web application.
Safari's generated Xcode wrapper and local signing settings are not checked into Git. See
the [current native status](docs/native-macos-sync-2026-11-06.md) for completed work and
remaining live acceptance.

This repository implements the production pipeline through **Milestone 8: hardening and
release readiness**, plus an opt-in browser-session editing beta. The synchronized Gantt
workspace supports persisted text, status, status-category, assignee, issue-type,
priority, label, date-quality, blocked, and unresolved filters with AND/OR dropdown logic.
Dependency arrows connect visible prerequisite and dependent bars; schedule conflicts and
blocked work have textual and visual indicators. Fixed-row virtualization keeps the live
DOM bounded while preserving the full accessible row count for up to 1,000 loaded issues.
Explicit **Edit Jira** mode can update editable start/due fields, the assignee, and
issue-link dependencies. Every mutation requires confirmation and Jira remains
authoritative for permissions and field configuration.

## Prerequisites

- Node.js 22.14 or newer (use the current LTS release)
- pnpm 10 or newer
- Google Chrome stable for manual extension testing

## Install and verify

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The production extension is written to `dist/extension`.

## Load the unpacked extension

1. Run `pnpm build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the generated `dist/extension` directory.
6. Open the extension popup and select **Open Power View**.

Chrome opens `app/index.html` in a separate extension tab. After **Test Jira connection**
succeeds, load the available projects and fields, select a project, edit the generated
JQL, map fields if required, and select **Load issue preview**. Power View loads and
normalizes up to 1,000 accessible issues without requesting descriptions, then opens the
full-width Gantt workspace below setup. Expand hierarchy, change timeline zoom, select a
row or bar for details, filter the loaded issues, or open the issue in Jira. Filter and
zoom preferences are saved per Jira instance and project. To edit a task, select it,
choose **Edit Jira**, make one scoped change, and confirm the browser dialog. The view
reloads the active JQL after Jira accepts the change.

For Jira Cloud, open a page under `https://*.atlassian.net`, then use the popup. For a
custom Jira host, enter its HTTPS URL in the popup and approve the exact-site request.
Reload the Jira tab if Chrome cannot inject the detector into a page that was already
open.

## Safari on macOS

A local Safari preview can be built with `pnpm build:safari`. Generate its Xcode wrapper
once with `pnpm safari:project`, then build and run it in Xcode. See
[the Safari guide](docs/safari.md) for setup, updates, and the live Jira verification
checklist.

## Update notifications

For an unpacked installation, build the extension with `pnpm build` and click **↻ Update
app** in the Power View workspace header. Chrome reads the files from the folder listed
under **Loaded from** in the extension details. For this repository, use `dist/extension`.
The button reports when the open tab already has that build.

To apply a build from an older Power View tab, use the **Reload** icon on the Power View
card in `chrome://extensions`, then reopen Power View. **Diagnostics** shows the build
time so you can verify which build opened.

For packaged installations, **↻ Update app** asks Chrome to check its configured update
channel. See [enterprise updates](docs/enterprise-updates.md) for release setup.

## Development

Daily description-change reports have an explicit preview under **Reports → Description
changes**, including the native Swift app. Automatic Google Chat delivery runs in a
separate private GitHub Actions repository at 00:05 Kyiv for the previous calendar day. It
remains disabled until the protected Jira/Chat setup succeeds. See
[daily report setup and behavior](docs/daily-description-report.md).

Run `pnpm dev` to watch the web and extension builds. After an extension build changes,
select **Reload** on `chrome://extensions`.

For local UI inspection, the web dev server exposes sanitized `?gantt-preview` and
`?gantt-preview=large` fixtures. The large fixture contains 1,000 generated tasks and is
excluded from the production bundle.

Useful commands:

| Command                  | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `pnpm format`            | Apply deterministic formatting                      |
| `pnpm lint`              | Run ESLint with zero warnings allowed               |
| `pnpm typecheck`         | Typecheck every workspace with strict TypeScript    |
| `pnpm test`              | Run Vitest unit and component tests                 |
| `pnpm test:e2e`          | Run no-context and fixture Jira extension flows     |
| `pnpm build`             | Validate and package the production extension       |
| `pnpm package:extension` | Rebuild the deterministic ZIP from `dist/extension` |

## Workspace layout

```text
apps/extension             Chrome popup, service worker, and manifest
apps/web                   Full-page React application
apps/macos                 Native SwiftUI/AppKit app, core models and tests
apps/desktop               Electron preview and preload bridge
apps/report-bot            Daily Jira description report worker for private Actions
packages/domain            Framework-independent domain foundation
packages/jira-client       Cloud and Data Center connection and mutation adapters
packages/extension-messaging  Runtime messaging package boundary
packages/storage           Versioned storage package boundary
packages/update-checker    GitHub commit check for the popup's update notification
packages/ui                Shared React UI primitives
packages/test-fixtures     Sanitized fixture package
docs                       Architecture, security, testing, and release notes
```

The supplied `POWER_VIEW_FOR_JIRA_SDD.md` is the baseline implementation specification.
The editing beta intentionally adds a tightly allowlisted browser-session write path. The
build produces `dist/power-view-for-jira-0.3.2.zip` and a matching SHA-256 file. Store
signing and publication remain manual owner actions.

## Estimation board

Open **Estimation** from the workspace to prepare a client's release scope. Paste Jira
keys or upload CSV/TXT/TSV lists. Loaded workspace issues supply summaries and Jira links;
keys outside the loaded scope remain visible with an explicit missing-details label.

The Tech Lead records a positive estimate in developer days, subtask decomposition,
optional product questions and answers, and final scope. Confirming scope unlocks QA
preparation: QA Lead, environment, conditions, test plan, and test data. QA submission
then enables **Mark ready for development**. Technical changes reopen scope confirmation
and QA submission; QA changes reopen QA submission and readiness.

This first version stores one release draft per Jira instance and board on the current
device. **Export handoff** produces a JSON file that another lead can upload on the same
board to continue; replacing existing issue drafts requires confirmation. This is a manual
file handoff, not live collaboration. Estimates, decomposition, and readiness are local
preparation records: no Jira subtasks are created and no Jira status is changed.

## Desktop preview

An Electron desktop preview is available with `pnpm desktop`. See
[desktop setup](docs/desktop.md) for token authentication and current limitations.
