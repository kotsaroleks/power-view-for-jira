# Desktop coexistence

The user works on this Mac while agents run. On 2026-11-04, native Computer Use opened a
Power View menu over the user's unrelated window. Prevent recurrence.

- Run native app checks with `sh scripts/check-native-macos-background.sh`. This renders
  production views to files in a process that cannot activate or open visible windows. Use
  fixtures and in-memory transports.
- Use builds, model tests and API checks for the remaining native verification.
- Do not control the user's native desktop for acceptance: no Computer Use clicks,
  keyboard input, menus, dialogs, window activation, app launch/quit, or restarts. Do not
  substitute another desktop input technology.
- A separate macOS Space is not an isolated test session. Do not claim it prevents menus,
  keyboard input or focus from interfering with the user.
- If a check needs real desktop interaction, leave that check unverified and report it;
  continue independent work. Resume desktop control only if the user explicitly asks for
  that interaction after this restriction.
- Do not change the Computer Use plugin, its permissions, or macOS security settings as a
  workaround. Do not claim the upstream menu leak is fixed by a repository change.
