// Golden outputs are produced by the existing product, not copied from the Swift port.
import { calculateReportResult } from "../packages/domain/src/reporting-calculations.ts";
import {
  buildDailyPeriod,
  buildWeeklyPeriod,
} from "../packages/domain/src/reporting-period.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const user = (id, displayName) => ({ id, displayName });
const ada = user("ada", "Ada"),
  bob = user("bob", "Bob"),
  contributor = user("writer", "Contributor");
const issue = (id, status, assignee, points, estimate, spent) => ({
  id,
  key: `APP-${id}`,
  browseUrl: `https://jira.example.test/browse/APP-${id}`,
  summary: `Issue ${id}`,
  issueType: { id: "1", name: "Story" },
  status: { id: status, name: status === "done" ? "Done" : "Open" },
  ...(assignee ? { assignee } : {}),
  ...(points === undefined ? {} : { storyPoints: points }),
  ...(estimate === undefined ? {} : { originalEstimateSeconds: estimate }),
  timeSpentSeconds: spent,
  sprintIds: ["7"],
});
const issues = [
  issue("1", "done", ada, 3, 28800, 72000),
  issue("2", "open", bob, 5, 57600, 3600),
  issue("3", "open", undefined, undefined, undefined, 0),
  issue("4", "done", ada, 0, 0, 0),
];
const event = (id, issueId, type, time, actor) => ({
  id,
  issueId,
  issueKey: `APP-${issueId}`,
  type,
  occurredAt: time,
  ...(actor ? { actor } : {}),
});
const input = {
  issues,
  changes: [
    event("old", "1", "issue-completed", "2026-01-01T00:00:00.000Z"),
    event("a", "1", "sprint-added", "2026-08-03T06:00:00.000Z", ada),
    event("b", "1", "sprint-removed", "2026-08-03T07:00:00.000Z"),
    event("c", "1", "sprint-added", "2026-08-03T08:00:00.000Z"),
    event("d", "1", "issue-completed", "2026-08-03T09:00:00.000Z", bob),
    event("e", "2", "issue-reopened", "2026-08-03T10:00:00.000Z"),
    event("f", "3", "issue-created", "2026-08-03T11:00:00.000Z"),
    event("end", "2", "issue-completed", "2026-08-04T05:00:00.000Z"),
  ],
  worklogs: [
    {
      id: "w1",
      issueId: "1",
      issueKey: "APP-1",
      author: contributor,
      startedAt: "2026-08-03T05:00:00.000Z",
      timeSpentSeconds: 3600,
    },
    {
      id: "w2",
      issueId: "2",
      issueKey: "APP-2",
      author: ada,
      startedAt: "2026-08-03T12:00:00.000Z",
      timeSpentSeconds: 7200,
    },
    {
      id: "outside",
      issueId: "1",
      issueKey: "APP-1",
      author: contributor,
      startedAt: "2026-08-04T05:00:00.000Z",
      timeSpentSeconds: 900,
    },
  ],
  period: buildDailyPeriod("2026-08-04", "2026-08-04T10:00:00.000Z"),
  type: "daily",
  scope: { kind: "team" },
  statusMapping: {
    schemaVersion: 1,
    jiraBaseUrl: "https://jira.example.test",
    boardId: "1",
    completedStatusIds: ["done"],
    completedStatusNames: ["Done"],
    updatedAt: "2026-08-03T10:00:00.000Z",
  },
};
const cases = [
  { name: "daily-team", input },
  {
    name: "weekly-team",
    input: {
      ...input,
      type: "weekly",
      period: buildWeeklyPeriod("2026-08-05", "2026-08-05T10:00:00.000Z"),
    },
  },
  ...["issue-count", "story-points", "original-estimate"].map((mode) => ({
    name: `sprint-${mode}`,
    input: { ...input, type: "sprint" },
    mode,
  })),
  { name: "individual", input: { ...input, scope: { kind: "assignee", userId: "ada" } } },
  {
    name: "contributor",
    input: { ...input, scope: { kind: "assignee", userId: "writer" } },
  },
  {
    name: "empty",
    input: { ...input, type: "sprint", issues: [], changes: [], worklogs: [] },
    mode: "original-estimate",
  },
];
for (const test of cases) test.expected = calculateReportResult(test.input, test.mode);
const periods = ["2026-03-29", "2026-03-30", "2026-10-25", "2026-10-26"].flatMap((date) =>
  ["daily", "weekly"].map((type) => ({
    date,
    type,
    generatedAt: "2026-12-01T00:00:00.000Z",
    expected: (type === "daily" ? buildDailyPeriod : buildWeeklyPeriod)(
      date,
      "2026-12-01T00:00:00.000Z",
    ),
  })),
);
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/reporting-golden.json",
    import.meta.url,
  ),
  JSON.stringify({ cases, periods }, null, 2) + "\n",
);
console.log(
  `Generated ${cases.length} calculation and ${periods.length} DST period fixtures from TypeScript.`,
);
const { buildBoardHealthReport, buildSprintHealthReport } =
  await import("../packages/domain/src/report.ts");
const sprint = { id: "7", name: "Sprint 7", state: "active", boardId: "1" };
const normalized = [
  {
    id: "1",
    key: "APP-1",
    summary: "One",
    status: { id: "done", name: "Done", category: "done" },
    storyPoints: 3,
    assignee: { accountId: "ada", displayName: "Ada" },
    resolvedAt: "2026-08-03T12:00:00.000Z",
    sprints: [sprint],
  },
  {
    id: "2",
    key: "APP-2",
    summary: "Two",
    status: { id: "open", name: "Open", category: "to-do" },
    storyPoints: 5,
    sprints: [sprint],
  },
  {
    id: "3",
    key: "APP-3",
    summary: "Three",
    status: { id: "review", name: "Review", category: "in-progress" },
    assignee: { accountId: "bob", displayName: "Bob" },
    sprints: [{ id: "8", name: "Next", state: "future", boardId: "1" }],
  },
  {
    id: "4",
    key: "APP-4",
    summary: "Four",
    status: { name: "Mystery", category: "unknown" },
  },
];
const options = {
  now: "2026-08-05T00:00:00.000Z",
  sprintDataAvailable: true,
  completedStatusIds: ["done"],
  completedStatusNames: ["Done"],
  preferredBoardId: "1",
};
const health = [true, false].map((available) => ({
  issues: normalized,
  sprint,
  blockedIDs: ["2"],
  options: { ...options, sprintDataAvailable: available },
}));
for (const fixture of health) {
  fixture.expectedBoard = buildBoardHealthReport(fixture.issues, {
    ...fixture.options,
    now: new Date(fixture.options.now),
  });
  fixture.expectedSprint = buildSprintHealthReport(
    fixture.issues,
    fixture.sprint,
    new Set(fixture.blockedIDs),
    fixture.options,
  );
}
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/health-golden.json",
    import.meta.url,
  ),
  JSON.stringify(health, null, 2) + "\n",
);

// Compare the blocking calculation independently of Gantt schedule and cascade fixtures below.
const viteRequire = createRequire(createRequire(import.meta.url).resolve("vite"));
const { build } = await import(pathToFileURL(viteRequire.resolve("esbuild")).href);
const bundle = await build({
  entryPoints: [new URL("../packages/domain/src/schedule.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { buildGanttScheduleModel } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const blockingIssue = (key, category = "to-do", name = "To Do", issueLinks = []) => ({
  id: "id-" + key,
  key,
  browseUrl: "https://jira.example.test/browse/" + key,
  summary: key,
  issueType: { id: "1", name: "Task", subtask: false },
  status: { name, category },
  project: { id: "100", key: "APP", name: "Test" },
  labels: [],
  components: [],
  fixVersions: [],
  issueLinks,
  rawFieldPresence: {
    hasStartDate: false,
    hasDueDate: false,
    hasParent: false,
    hasEpic: false,
  },
});
const dep = (linkedIssueKey, semanticType, direction = "outward") => ({
  typeName: "Fixture",
  linkedIssueKey,
  semanticType,
  direction,
});
const blocking = [
  blockingIssue("APP-1", "to-do", "To Do", [dep("APP-2", "blocks")]),
  blockingIssue("APP-2"),
  blockingIssue("APP-3", "done", "Done", [dep("APP-4", "blocks")]),
  blockingIssue("APP-4"),
  blockingIssue("APP-5", "to-do", "On Hold"),
  blockingIssue("APP-6", "to-do", "To Do", [dep("APP-1", "depends-on")]),
  blockingIssue("APP-7", "to-do", "To Do", [dep("APP-3", "finish-to-finish")]),
  blockingIssue("APP-8", "to-do", "To Do", [dep("OUTSIDE-1", "is-blocked-by", "inward")]),
];
const blockedIDs = buildGanttScheduleModel(blocking, { today: "2026-10-16" })
  .tasks.filter((task) => task.isBlocked)
  .map((task) => task.id)
  .sort();
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/blocked-golden.json",
    import.meta.url,
  ),
  JSON.stringify({ issues: blocking, expected: blockedIDs }, null, 2) + "\n",
);

const scheduleIssue = (key, extra = {}) => ({ ...blockingIssue(key), ...extra });
const scheduleCases = [
  [scheduleIssue("APP-1", { startDate: "2026-10-23", originalEstimateSeconds: 57600 })],
  [scheduleIssue("APP-1", { dueDate: "2026-10-26", originalEstimateSeconds: 57600 })],
  [scheduleIssue("APP-1")],
  [
    scheduleIssue("APP-1", {
      startDate: "2026-10-22",
      dueDate: "2026-10-21",
      originalEstimateSeconds: 57600,
    }),
  ],
  [
    scheduleIssue("APP-1", {
      startDate: "2026-10-22",
      dueDate: "2026-10-22",
      originalEstimateSeconds: 0,
    }),
  ],
  [
    scheduleIssue("APP-1", { startDate: "2026-10-01", dueDate: "2026-10-30" }),
    scheduleIssue("APP-2", {
      parentKey: "APP-1",
      startDate: "2026-10-19",
      dueDate: "2026-10-22",
      issueType: { id: "2", name: "Subtask", subtask: true },
      status: { name: "Done", category: "done" },
    }),
    scheduleIssue("APP-3", {
      parentKey: "APP-1",
      startDate: "2026-10-20",
      dueDate: "2026-10-26",
      issueType: { id: "2", name: "Subtask", subtask: true },
    }),
  ],
  [
    scheduleIssue("APP-1", { parentKey: "APP-2", startDate: "2026-10-19" }),
    scheduleIssue("APP-2", { parentKey: "APP-1", dueDate: "2026-10-21" }),
  ],
  [
    scheduleIssue("APP-1", {
      startDate: "invalid",
      dueDate: "2026-10-21",
      progress: { percentage: 27.6, source: "jira-progress" },
    }),
  ],
].map((issues) => {
  const options = { today: "2026-10-19" };
  const result = buildGanttScheduleModel(issues, options);
  return {
    issues,
    options,
    expected: result.tasks.map((task) => ({
      key: task.issueKey,
      start: task.start,
      end: task.end,
      state: task.scheduleState,
      startSource: task.startSource,
      endSource: task.endSource,
      progress: task.progress,
      progressSource: task.progressSource,
      warnings: result.warnings
        .filter((warning) => warning.issueKey === task.issueKey)
        .map((warning) => warning.code),
    })),
  };
});
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/schedule-golden.json",
    import.meta.url,
  ),
  JSON.stringify(scheduleCases, null, 2) + "\n",
);

const estimation = await import("../apps/web/src/app/estimation/workflow.ts");
let nativeDraft = estimation.emptyDraft();
const estimationEdits = [
  ["techLead", "Alex"],
  ["days", "3.5"],
  ["decomposition", "API 2 days\nUI 1.5 days"],
  ["questions", "Which roles?"],
  ["answers", "All project members"],
  ["questionsResolved", true],
  ["scope", "Members can estimate scope"],
  ["scopeConfirmed", true],
  ["qaLead", "Sam"],
  ["environment", "Staging"],
  ["conditions", "Authenticated member"],
  ["testPlan", "Success and failure"],
  ["testData", "Synthetic project"],
  ["qaSubmitted", true],
  ["ready", true],
  ["scope", "Changed scope"],
];
const estimationCases = estimationEdits.map(([field, value]) => {
  nativeDraft = estimation.updateDraft(nativeDraft, field, value);
  return {
    field,
    value,
    expected: nativeDraft,
    stage: estimation.stages.indexOf(estimation.stageFor(nativeDraft)),
    techComplete: estimation.techComplete(nativeDraft),
    scopeComplete: estimation.scopeComplete(nativeDraft),
    qaComplete: estimation.qaComplete(nativeDraft),
  };
});
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/estimation-golden.json",
    import.meta.url,
  ),
  JSON.stringify(estimationCases, null, 2) + "\n",
);

const cascadeBundle = await build({
  entryPoints: [
    new URL("../apps/web/src/app/gantt-v2/cascade-schedule.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { planCascadeSchedule } = await import(
  `data:text/javascript;base64,${Buffer.from(cascadeBundle.outputFiles[0].text).toString("base64")}`
);
const cascadeCases = ["FS", "SS", "FF", "SF"].flatMap((type) =>
  [0, 2].map((lagWorkingDays) => {
    const input = {
      tasks: [
        { issueKey: "APP-1", start: "2026-10-19", end: "2026-10-21" },
        { issueKey: "APP-2", start: "2026-10-20", end: "2026-10-22" },
        { issueKey: "APP-3", start: "2026-10-23", end: "2026-10-26" },
      ],
      dependencies: [
        {
          id: "a",
          predecessorIssueKey: "APP-1",
          successorIssueKey: "APP-2",
          type,
          lagWorkingDays,
        },
        {
          id: "b",
          predecessorIssueKey: "APP-2",
          successorIssueKey: "APP-3",
          type: "FS",
          lagWorkingDays: 0,
        },
      ],
      changedIssueKey: "APP-1",
      changedDates: { startDate: "2026-10-23", dueDate: "2026-10-27" },
      nonWorkingDays: [0, 6],
    };
    return { input, expected: planCascadeSchedule(input).updates };
  }),
);
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/cascade-golden.json",
    import.meta.url,
  ),
  JSON.stringify(cascadeCases, null, 2) + "\n",
);

const conflictBundle = await build({
  entryPoints: [
    new URL(
      "../apps/web/src/app/gantt-v2/external-schedule-conflicts.ts",
      import.meta.url,
    ).pathname,
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { findExternalScheduleConflicts } = await import(
  `data:text/javascript;base64,${Buffer.from(conflictBundle.outputFiles[0].text).toString("base64")}`
);
const externalCases = [false, true].map((moved) => {
  const source = cascadeCases[0].input;
  const tasks = source.tasks.map((task) => ({
    ...task,
    scheduleState: "confirmed",
    ...(moved && task.issueKey === "APP-1"
      ? { start: "2026-10-23", end: "2026-10-27" }
      : {}),
  }));
  const boardState = {
    dependencies: source.dependencies,
    reconciledDates: { "APP-1": { startDate: "2026-10-19", dueDate: "2026-10-21" } },
  };
  const input = { tasks, boardState, nonWorkingDays: [0, 6] };
  return { input, expected: findExternalScheduleConflicts(input) };
});
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/external-conflicts-golden.json",
    import.meta.url,
  ),
  JSON.stringify(externalCases, null, 2) + "\n",
);

const filterBundle = await build({
  entryPoints: [new URL("../packages/domain/src/filters.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { sortGanttTasks } = await import(
  `data:text/javascript;base64,${Buffer.from(filterBundle.outputFiles[0].text).toString("base64")}`
);
const ganttSource = readFileSync(
  new URL("../apps/web/src/app/gantt-v2/GanttV2.tsx", import.meta.url),
  "utf8",
);
const visibleStart = ganttSource.indexOf("function visibleTasks(");
const visibleSource = ganttSource.slice(
  visibleStart,
  ganttSource.indexOf("\nfunction taskColor", visibleStart),
);
const filteredStart = ganttSource.indexOf("const filteredTasks = useMemo");
const filteredBody = ganttSource.slice(
  ganttSource.indexOf("    const query =", filteredStart),
  ganttSource.indexOf("\n  }, [expanded", filteredStart),
);
const visibilityBundle = await build({
  stdin: {
    contents: `${visibleSource}\nexport function filterActual(sortedTasks, expanded, search, hideCompleted) {\n${filteredBody}\n}`,
    loader: "ts",
  },
  write: false,
  format: "esm",
  platform: "node",
});
const { filterActual } = await import(
  `data:text/javascript;base64,${Buffer.from(visibilityBundle.outputFiles[0].text).toString("base64")}`
);
const hierarchyTasks = [
  {
    id: "APP-1",
    issueKey: "APP-1",
    name: "Zulu",
    start: "2026-10-22",
    end: "2026-10-23",
    statusName: "Review",
    statusCategory: "in-progress",
    assigneeName: "Bea",
    depth: 0,
  },
  {
    id: "APP-10",
    issueKey: "APP-10",
    parentId: "APP-1",
    name: "Same",
    start: "2026-10-21",
    end: "2026-10-24",
    statusName: "Done",
    statusCategory: "done",
    assigneeName: "Alex",
    depth: 1,
  },
  {
    id: "APP-2",
    issueKey: "APP-2",
    parentId: "APP-1",
    name: "same",
    start: "2026-10-20",
    end: "2026-10-25",
    statusName: "To Do",
    statusCategory: "to-do",
    assigneeName: "alex",
    depth: 1,
  },
  {
    id: "APP-3",
    issueKey: "APP-3",
    name: "Alpha",
    start: "",
    end: "",
    statusName: "",
    statusCategory: "unknown",
    assigneeName: "",
    depth: 0,
  },
  {
    id: "APP-4",
    issueKey: "APP-4",
    name: "Beta",
    start: "2026-10-19",
    end: "2026-10-26",
    statusName: "Done",
    statusCategory: "done",
    depth: 0,
  },
];
const hierarchyCases = [];
for (const sortBy of [
  "default",
  "startDate",
  "endDate",
  "name",
  "status",
  "assignee",
  "issueKey",
]) {
  for (const direction of ["asc", "desc"]) {
    const input = {
      tasks: hierarchyTasks,
      sortBy,
      direction,
      collapsed: [],
      query: "",
      hideDone: false,
    };
    const sorted = sortGanttTasks(hierarchyTasks, sortBy, direction);
    hierarchyCases.push({
      input,
      expected: filterActual(
        sorted,
        new Set(hierarchyTasks.map((t) => t.id)),
        "",
        false,
      ).map((t) => ({ id: t.id, depth: t.depth })),
    });
  }
}
for (const [collapsed, query, hideDone] of [
  [["APP-1"], "APP-2", false],
  [[], " APP-2 ", false],
  [[], "alex", false],
  [[], "", true],
  [["APP-1"], "", true],
]) {
  const input = {
    tasks: hierarchyTasks,
    sortBy: "default",
    direction: "asc",
    collapsed,
    query,
    hideDone,
  };
  const expanded = new Set(
    hierarchyTasks.filter((t) => !collapsed.includes(t.id)).map((t) => t.id),
  );
  hierarchyCases.push({
    input,
    expected: filterActual(hierarchyTasks, expanded, query, hideDone).map((t) => ({
      id: t.id,
      depth: t.depth,
    })),
  });
}
writeFileSync(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/hierarchy-golden.json",
    import.meta.url,
  ),
  JSON.stringify(hierarchyCases, null, 2) + "\n",
);

// The printable template is the Chrome product's actual implementation.
const printBundle = await build({
  entryPoints: ["apps/web/src/app/reporting/report-html.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "print-css",
      setup(builder) {
        builder.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
          path: args.path,
          namespace: "print-css",
        }));
        builder.onLoad({ filter: /.*/, namespace: "print-css" }, () => ({
          contents: 'export default ""',
          loader: "js",
        }));
      },
    },
  ],
});
const printModule = await import(
  `data:text/javascript;base64,${Buffer.from(printBundle.outputFiles[0].text).toString("base64")}`
);
const reportGolden = JSON.parse(
  readFileSync(
    "apps/macos/Tests/PowerViewCoreTests/Fixtures/reporting-golden.json",
    "utf8",
  ),
);
const printCases = reportGolden.cases
  .filter((item) => item.input.type !== "sprint")
  .map((item) => {
    const snapshot = {
      id: "11111111-1111-1111-1111-111111111111",
      generatedAt: item.input.period.end,
      board: { id: "1", name: "Printable reference" },
      jira: { baseUrl: "https://jira.example.test" },
      request: {
        type: item.input.type,
        period: item.input.period,
        scope: item.input.scope,
      },
      issues: item.input.issues,
      statusMapping: item.input.statusMapping,
      result: item.expected,
    };
    return {
      name: item.name,
      snapshot,
      html: printModule.buildPrintableReportHtml(snapshot, "en"),
    };
  });
writeFileSync(
  "apps/macos/Tests/PowerViewCoreTests/Fixtures/report-print-golden.json",
  JSON.stringify(printCases, null, 2) + "\n",
);
