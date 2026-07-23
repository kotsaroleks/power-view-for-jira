# Testing

Run the quality suite from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Build first, install the Playwright Chromium browser, then run `pnpm test:e2e`. Playwright
verifies both the safe no-context shell and a routed Jira Cloud fixture that detects
context, reuses the browser-session transport, loads metadata/issues, renders a dependency
connector, and applies the blocked filter.

Milestone 5 coverage exercises parent-versus-epic precedence, subtasks, missing parents,
hierarchy cycles, depth limits, every start/end fallback, invalid date correction,
configurable duration bounds and persistence, Jira/subtask/child/status progress priority,
blocking-link dependencies, synthetic warning metadata, deterministic output, and
raw-Jira-to-Gantt fixture integration.

Milestone 6 component coverage additionally verifies deterministic renderer geometry,
day/week/month zoom, in-range and out-of-range today behavior, identical tree/timeline row
counts, collapse/expand persistence, task selection, date/progress source details, warning
display, and read-only Jira links. The development-only `?gantt-preview` route provides a
sanitized local visual fixture for browser interaction and layout checks.

Milestone 7/8 coverage verifies combined filter predicates, date-quality and overdue
rules, unassigned/no-priority/no-label handling, blocked/unresolved risk filters, ancestor
preservation, optional descendants, saved project-scoped filters and zoom, v1-to-v2
storage migration, dependency connector geometry, empty results, and fixed-row
virtualization. A benchmark runs the pure filter pipeline 25 times over 1,000 sanitized
tasks with a generous regression ceiling; the test also asserts the exact result count.
Component coverage confirms that a 1,000-task grid keeps the full ARIA row count while
mounting fewer than 40 synchronized DOM rows.

The browser-session editing beta adds policy, transport, client, domain, and component
coverage for issue edit metadata, assignable users, start/due updates, assignee updates,
issue-link creation/deletion, empty Jira write responses, confirmation gating, and the
no-automatic-retry rule for mutations.

## Manual Jira write smoke test

Use a disposable Jira project and issues that can safely be changed:

1. Build and reload the unpacked extension, then keep the detected Jira tab open and
   signed in.
2. Load a small JQL result in Power View and select one issue.
3. Select **Edit Jira**. Confirm that fields disabled by Jira edit metadata cannot be
   changed.
4. Change one date and confirm the dialog. Verify the value both after the Gantt refresh
   and in Jira.
5. Search for an assignable user, save the assignee, and verify it in Jira. Restore the
   original assignee afterward.
6. Add a dependency using the Jira **Blocks** type, verify the direction in both issues,
   then use **Remove** to delete the created link.
7. Deny one confirmation dialog and verify that Jira remains unchanged.

These actions modify real Jira data. The current user needs Edit Issues, Assign Issues,
Schedule Issues where applicable, Browse Projects, and Link Issues permissions.

## Manual compatibility matrix

Run read flows on Jira Cloud and every supported Data Center/Server version:

- project, issue, board, and filter URL context detection;
- signed-in, signed-out, 401, 403, rate-limit, timeout, and closed-context-tab states;
- zero, 1–100, 101–1,000, and truncated result sets;
- missing date fields, inferred dates, hierarchy cycles, missing parents, and blocking
  links;
- day/week/month zoom, keyboard-only filtering and selection, reduced motion, narrow
  viewport, and 200% browser zoom;
- allowed and denied date, assignee, and dependency mutations in a disposable project.

Real Jira instances and permissions cannot be fully simulated in CI; record the Jira
version, browser version, test account role, date, and result with each release candidate.
