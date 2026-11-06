# Power View Desktop preview

The Electron preview reuses the existing React workspace and Jira Cloud/Data Center
clients. It sends validated REST requests from Electron's main process, without a Jira
browser tab. The Chrome extension remains a separate build.

## Run

```sh
pnpm install
pnpm build:desktop
pnpm --filter @power-view/desktop start
```

If pnpm blocks Electron's install script, run
`pnpm --filter @power-view/desktop exec node node_modules/electron/install.js`.

Enter the HTTPS Jira site URL, Atlassian email and an API token **without scopes** for
Jira Cloud. For Data Center choose that deployment and use a personal access token; email
is not used for its Bearer authentication.

The connection is encrypted with Electron safeStorage and stored in the application's
user-data directory. On macOS safeStorage uses Keychain-backed encryption. The app refuses
to save credentials if system encryption is unavailable. Credentials are never returned to
the renderer after entry. Change Jira connection deletes the saved credential. Workspace
settings use a separate JSON file in user data. Estimation and other existing
browser-local drafts remain local to this desktop profile; extension data is not migrated.

Requests retain the extension endpoint and body allowlist, reject redirects, and have a
60-second timeout. Writes are never retried. The renderer has no Node access; only the
main frame can call the narrow preload bridge. External HTTPS links open in the browser.

This is a development preview, not a signed installer. Automatic desktop updates, packaged
distribution, scoped Cloud tokens and OAuth are not implemented. Connection validation
runs in the existing workspace after the credential is saved. A failed token can be
replaced using Change Jira connection. No live Jira credentials are included in tests or
builds.
