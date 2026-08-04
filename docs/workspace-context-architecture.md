# Power View workspace context

## Problem found during the application audit

The application previously had multiple competing sources of scope:

| Area                        | Previous source                                             | Failure mode                                                      |
| --------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Setup                       | detected project plus project-keyed settings                | Board was not explicitly selected                                 |
| Board Health                | loaded JQL plus detected `context.boardId`                  | A Jira page opened on another board changed sprint statistics     |
| Daily/Weekly/Sprint Reports | a second project/board loader and a separate settings store | Reports could use a different board and completed-status mapping  |
| Report generator            | board ID only                                               | Saved Setup JQL was ignored and a broader board scope was loaded  |
| Gantt preferences           | project key only                                            | Boards in the same project shared filters and zoom                |
| Tests                       | component-local normalized mocks                            | Incorrect Jira payload types and disconnected scopes still passed |

## Authoritative workspace configuration

The saved Setup configuration is now the only source of global workspace scope:

```text
Jira instance
  → Project
    → Board
      → Board filter / saved JQL
        → Field mapping
        → Completed-status mapping
```

Detected Jira page context is only an initial suggestion. After Setup is saved, downstream
views must not read project or board scope directly from the browser page context.

## Cascading rules

1. Setup loads all accessible boards for the selected project and requires an explicit
   board.
2. Selecting a board loads its filter JQL and all status values available in its issue
   scope.
3. Setup persists project, board metadata, JQL, field mappings, durations and completed
   statuses in one configuration.
4. Board Health receives the saved board, JQL-loaded normalized issues and
   completed-status mapping.
5. Daily, Weekly and Sprint Reports receive the same board, JQL and status mapping. They
   cannot select or save another board locally.
6. Report type, report date, person/team scope, sprint, language and completion basis
   remain run parameters because they describe one generated report rather than the
   workspace.
7. Gantt receives the same JQL-loaded schedule. Its UI preferences are scoped by Jira
   instance, project and board.
8. Report history is filtered by Jira instance and board.

## Jira API contracts

- Project boards: `/rest/agile/1.0/board`
- Board configuration: `/rest/agile/1.0/board/{boardId}/configuration`
- Board issues: `/rest/agile/1.0/board/{boardId}/issue`
- Active sprints: `/rest/agile/1.0/board/{boardId}/sprint`
- Sprint issues: `/rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue`

Board and sprint issue endpoints return reporting snapshots. They are not interchangeable
with the normalized issues produced by Setup JQL search. Sprint responses are used for
membership IDs; metrics and UI details are calculated from normalized Setup issues.

## Required test contracts

- Storage round-trip preserves board and completed-status mapping.
- Setup test uses real project, board, board configuration, board issue and JQL-search
  payloads.
- App integration test covers Connect → Project → Board → Save → Reports and verifies that
  the configured board is inherited without a second selector.
- Reports component test verifies it never calls `getBoards` and has no local mapping
  controls.
- Report generator tests verify saved JQL is passed to every board and sprint issue
  request.
- Board Health tests verify sprint membership IDs are intersected with normalized Setup
  issues.
- Domain tests verify Board Health and generated reports use the same completed-status
  mapping.
- Jira client tests pin public Agile REST paths for board and sprint issue loading.

Passing unit tests without these contracts is not sufficient evidence that the application
works.
