# Power View for Jira

Power View for Jira is a Chrome Manifest V3 extension for Jira planning views in a
separate full-page workspace. The first production module is a Gantt view.

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

## Update notifications

The extension is loaded unpacked, so Chrome cannot silently auto-update it. The
**Updates** section in the popup notifies you when `main` has commits you don't have yet,
so you know when to pull and rebuild — it doesn't replace the manual workflow:

1. `git pull && pnpm build`
2. Click **Update** (the reload icon) for Power View for Jira on `chrome://extensions`.

That reloads the unpacked extension in place — no delete or reinstall.

To enable the check, since this repository is private, generate a fine-grained GitHub
Personal Access Token scoped read-only to it:

1. GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**.
2. Repository access → **Only select repositories** → this repository.
3. Repository permissions → **Contents** → **Read-only**.
4. Set a short expiration (e.g. 90 days). When it expires, the popup will show "Token
   appears invalid" — generate a new one and save it again.

Paste the token into the popup's **Updates** section. It's stored only in
`chrome.storage.local` on your machine and sent only to `api.github.com`. The extension
checks hourly in the background (showing a badge on the toolbar icon when an update is
available) and on demand via **Check now**.

## Development

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
build produces `dist/power-view-for-jira-0.1.0.zip` and a matching SHA-256 file. Store
signing and publication remain manual owner actions.
