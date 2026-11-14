# Chrome Settings UX — 2026-11-10

The Settings page now puts Jira workspace selection and the shared issue query first.
App-section switches sit in a compact sidebar on desktop and move below the form on narrow
screens. Optional planning controls and import/export use separate disclosures. The page
has a clear heading, Back to Workspace action, consistent type, neutral card styles,
larger form controls, and a sticky Save and open Workspace action.

Preview issues and Refresh from Jira read the draft without saving settings, navigating
away, or replacing the active workspace. Draft edits remain available after navigating
away and returning. Validation moves focus to the error summary; editing the query clears
stale feedback. Enter in the project search does not submit the workspace form.

## Verification

- `pnpm exec vitest run --maxWorkers=2`: 735 tests, 104 files passed.
- `pnpm exec playwright test --workers=1 --reporter=line`: all 21 browser tests passed.
- After the final search/feedback refinement, reran the 21 App/SetupPanel component tests
  and the two Settings browser scenarios, plus targeted lint and root type checking.
- Full lint, workspace type checking, formatting, and extension build/validation passed.
- Layout checks cover expanded options at 1440, 1024, 768, 390, and 320 CSS pixels, with
  no horizontal page overflow. The save action is inside the viewport and passes browser
  hit testing. Existing menu checks also cover 200% Chrome zoom.

The browser checks use the actual built extension in disposable headless Chrome profiles,
with Jira and GitHub fixture responses. They do not use the user's Chrome profile, native
desktop, or real Jira data. Applying the build to the user's installed extension requires
reloading that extension in Chrome.

## Evidence

- `before.png`: previous page, full-page capture.
- `settings-desktop.png`: current page at 1440 × 900.
- `settings-390.png`, `settings-320.png`: current narrow-screen viewport captures.
- `unit-tests.log`, `browser-tests.log`: complete suites.
- `settings-unit-tests.log`, `settings-browser-tests.log`: final targeted checks.
- `build.log`: regular delivery build, without the test calendar override.
