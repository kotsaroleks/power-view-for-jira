# Safari for macOS — local preview

Safari shares the React workspace, Jira adapters, permission checks, and editing rules
with Chrome. This is a local preview: compilation and automated tests do not confirm
compatibility with a live Jira session. Use Safari 18.4 or newer on macOS.

## Build and run

Requires macOS, full Xcode, Node.js, pnpm, and installed workspace dependencies.

```sh
pnpm build:safari
pnpm safari:project
open "safari/Power View for Jira/Power View for Jira.xcodeproj"
```

The first command builds Chrome and prepares `dist/safari-extension`. Safari omits Chrome
enterprise update metadata and uses a bundled classic background worker. The second
command uses Apple's extension converter to create a macOS app and its embedded Safari
extension. The generated project lives in the ignored `safari/` directory. It references
the built resources directly, so do not move the checkout. Run `safari:project` only for
initial creation; keep your existing project and signing settings for later builds. The
bundle identifier defaults to `com.kotsaroleks.powerviewforjira`; change it in Xcode if
your signing team requires it.

In Xcode, select the Power View for Jira scheme and My Mac, configure Signing &
Capabilities for both targets if needed, and run the app. Enable the extension in Safari →
Settings → Extensions and allow access to the Jira website. Local unsigned extension
testing may require Safari's Develop → Allow Unsigned Extensions option. The containing
app provides a shortcut to Safari's extension settings.

For subsequent changes, run `pnpm build:safari`, then build/run the existing Xcode project
again. `pnpm build` alone cleans the Safari web resources; run `build:safari` before
building the native app. Safari's popup explains the macOS app update flow; Chrome's
enterprise checks and reload controls are disabled there.

## Verification before release

- Open a signed-in Jira Cloud tab, then Open Power View from the toolbar popup.
- Test the connection, load projects/fields/issues, and inspect the Gantt workspace.
- Reload Safari and verify preferences persist and Jira context is detected again.
- Check a custom HTTPS Jira host, approve access, and reload its tab if needed.
- Revoke site access and verify further Jira requests fail.
- On a disposable issue, confirm one date/assignee/dependency edit and verify Jira.
- Verify a logged-out session, denied access, closed Jira tab, and multiple Jira tabs.

Do not infer runtime support from Apple's manifest conversion alone. In particular,
exercise session storage, dynamic content-script registration, and the MAIN-world request
fallback on the target Safari version. Release signing and distribution are configured
separately in Xcode; this preview does not publish an app.
