# Description report verification — 7 November 2026

Product source: `abebcf8722226dce47921ea1f421496eece9f7b7`. All screenshots use synthetic
Jira fixtures. The background checker never controls the user's running Power View app.

| Check                                | Result                                                                                        | Evidence                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Full JavaScript/component suite      | 707 passed across 101 files                                                                   | [Log](javascript-tests.log)                                          |
| New description report cases         | 41 passed: calendar/DST, collector, preview, delivery, retries and transports                 | [Focused log](targeted-tests.log)                                    |
| Browser request policy               | 21 passed, including exact ancestor metadata fields and rejected description/full-field reads | [Log](request-policy-tests.log)                                      |
| Strict TypeScript                    | All 12 workspaces passed                                                                      | [Log](typecheck.log)                                                 |
| ESLint and Prettier                  | Passed with zero lint warnings                                                                | Reproducible root checks                                             |
| Swift suites                         | 114 core + 38 application tests passed                                                        | [Summary](swift-tests-summary.log)                                   |
| Production headless browser journeys | Time Report with description preview; Timesheet CRUD; both passed                             | [Log](browser-e2e.log)                                               |
| Native production renders            | 31 passed; zero visible windows, zero real network transports and no desktop input            | [Manifest](native-verification.json)                                 |
| Native package                       | 0.1.0 build 6; plist and ad-hoc signature verified; arm64 ZIP produced                        | Local `apps/macos/dist`                                              |
| Chrome, Electron and Safari builds   | All produced from the committed source                                                        | Local `dist/description-report-release`                              |
| Private Actions deployment           | Worker bundle/configuration check succeeded on GitHub                                         | Credential-free `check` mode; this did not read Jira or post to Chat |

The API-to-delivery fixture exercises real collection and transport adapters through a
fake network: two changelog pages, an ancestor outside the candidate list, both editors,
private state writes and a Chat receipt. A lost Chat response is retried with the same
persisted body and request ID, resulting in one simulated message. A missing later history
page produces neither a checkpoint nor a Chat message. Google Chat itself has not been
contacted by these fixture tests.

The production browser journey uses the real built application and validates requests
through the extension policy. It confirms that preview is explicit, complete history and
ancestor reads succeed, both editors render, description bodies stay absent, and the date
control remains at least 40 pixels high on a narrow screen.

## Visual evidence

- [Web desktop preview](web-description-report-desktop.png)
- [Web mobile preview](web-description-report-mobile.png)
- [Native complete preview](native-description-report-form.png)
- [Native compact preview](native-description-report-form-compact.png)
- [Native verified empty result](native-description-report-empty.png)

## Acceptance limits

At this checkpoint the private automation repository is deployed with delivery disabled.
Protected Jira and target-space Chat settings have not been supplied. A real Jira
description-history read and a real Google Chat receipt remain unverified. The successful
Actions `check` run only verifies that GitHub can start the deployed worker environment
and parse its files. The protected setup performs the live read check before enabling the
schedule; actual delivery is confirmed separately by its workflow result and receipt.

The native checker renders detached production SwiftUI views under prohibited activation.
It checks no real pointer, keyboard, menu or scrolling interactions. Existing unsupported
week/month detached scroll probes remain listed in `unverifiedInteractions`; they are not
counted as successful interaction acceptance. The running app and user desktop were not
launched, quit, restarted or controlled.

Production Chrome/Electron/Safari builds were staged separately from the loaded extension
directory. The native bundle was published by the existing staging/rename script, which
preserves any already mapped executable. These local product builds can contain the
owner's private Day Off configuration and are not published as public GitHub artifacts.
