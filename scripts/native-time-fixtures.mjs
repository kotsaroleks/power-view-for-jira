// Golden results are computed by the current Chrome implementation, not the Swift port.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { weeklyRows } from "../apps/web/src/app/timesheet/weekly-row-model.ts";
import { buildTimeReport } from "../packages/domain/src/time-report.ts";
function sourceFunction(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`Missing source function: ${name}`);
  let first = source.indexOf("{", source.indexOf(")", start));
  let depth = 1,
    end = first + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return source.slice(start, end);
}
const duration = sourceFunction(
  readFileSync("apps/web/src/app/timesheet/timesheet-model.ts", "utf8"),
  "duration",
);
const warning = readFileSync(
  "apps/web/src/app/timesheet/time-zone-warning.ts",
  "utf8",
).replace(/^import[^\n]*\n/, "");
const { timeZoneWarning } = await import(
  "data:text/javascript;base64," +
    Buffer.from(stripTypeScriptTypes(duration + "\n" + warning)).toString("base64")
);
const issues = [
  { id: "1", key: "TEST-1", summary: "Epic", hierarchyLevel: 1 },
  {
    id: "2",
    key: "TEST-2",
    summary: "Story assigned",
    parentKey: "TEST-1",
    assigneeId: "fixture",
    hierarchyLevel: 0,
  },
  {
    id: "3",
    key: "TEST-3",
    summary: "Other story",
    parentKey: "TEST-1",
    assigneeId: "other",
    hierarchyLevel: 0,
  },
  {
    id: "4",
    key: "TEST-4",
    summary: "Subtask",
    parentKey: "TEST-2",
    assigneeId: "other",
    hierarchyLevel: -1,
  },
  { id: "5", key: "TEST-5", summary: "Orphan", assigneeId: "other", hierarchyLevel: 0 },
  {
    id: "6",
    key: "TEST-6",
    summary: "Cycle one",
    parentKey: "TEST-7",
    hierarchyLevel: 0,
  },
  {
    id: "7",
    key: "TEST-7",
    summary: "Cycle two",
    parentKey: "TEST-6",
    hierarchyLevel: 0,
  },
];
const weekly = [
  {
    name: "collapsed priority with pins and own time",
    logged: ["TEST-2"],
    pins: ["TEST-3"],
    priorities: ["TEST-1"],
    expanded: [],
    search: "",
  },
  {
    name: "expanded hierarchy",
    logged: ["TEST-2"],
    pins: [],
    priorities: ["TEST-1"],
    expanded: ["TEST-1"],
    search: "",
  },
  {
    name: "search reaches collapsed descendants",
    logged: [],
    pins: [],
    priorities: ["TEST-1"],
    expanded: [],
    search: "Subtask",
  },
  {
    name: "cycle remains reachable beside valid roots",
    logged: [],
    pins: [],
    priorities: [],
    expanded: [],
    search: "",
  },
  {
    name: "other group carries context of logged parent",
    logged: ["TEST-1", "TEST-2"],
    pins: [],
    priorities: [],
    expanded: [],
    search: "",
  },
].map((test) => ({
  ...test,
  issues,
  expected: weeklyRows({
    rows: issues.map((issue) => ({
      issue,
      cells: new Map(test.logged.includes(issue.key) ? [["2026-11-03", [{}]]] : []),
    })),
    boardIssues: issues,
    accountId: "fixture",
    pins: test.pins,
    priorities: test.priorities,
    expanded: test.expanded,
    search: test.search,
  }).map((row) => ({
    key: row.issue.key,
    group: row.group,
    depth: row.depth,
    hasChildren: row.hasChildren,
    withoutParent: row.withoutParent,
    parentHeading: row.parentHeading?.key ?? null,
  })),
}));
const users = [
  { userId: "fixture", displayName: "Fixture User" },
  { userId: "other", displayName: "Other User" },
];
const reports = [
  {
    name: "week with duplicate off and worked off date",
    weekStart: "2026-11-02",
    periodMode: "week",
    users,
    worklogs: [
      {
        id: "1",
        userId: "fixture",
        issueKey: "TEST-2",
        day: "2026-11-03",
        timeSpentSeconds: 3661,
      },
      {
        id: "2",
        userId: "other",
        issueKey: "TEST-3",
        day: "2026-11-04",
        timeSpentSeconds: 5400,
      },
    ],
    dayOffs: [
      { userId: "fixture", date: "2026-11-03" },
      { userId: "fixture", date: "2026-11-03" },
      { userId: "other", date: "2026-11-07" },
    ],
  },
  {
    name: "month ratio of sums",
    weekStart: "2026-11-01",
    periodMode: "month",
    users,
    worklogs: [
      {
        id: "3",
        userId: "fixture",
        issueKey: "TEST-2",
        day: "2026-11-30",
        timeSpentSeconds: 7200,
      },
    ],
    dayOffs: [{ userId: "other", date: "2026-11-02" }],
  },
].map((input) => ({ input, expected: buildTimeReport(input) }));
const warnings = [
  { zone: "Europe/Kyiv", days: ["2026-11-04"] },
  { zone: "Europe/Berlin", days: ["2026-11-04"] },
  { zone: "America/New_York", days: ["2026-10-26", "2026-11-02"] },
  { zone: "Asia/Kathmandu", days: ["2026-03-28", "2026-03-30"] },
].map((input) => ({
  ...input,
  expected: timeZoneWarning(input.zone, input.days) ?? null,
}));
writeFileSync(
  "apps/macos/Tests/PowerViewApplicationTests/Fixtures/time-tracking-golden.json",
  JSON.stringify({ weekly, reports, warnings }, null, 2) + "\n",
);
console.log(
  `Generated ${weekly.length} weekly, ${reports.length} report and ${warnings.length} timezone cases from Chrome.`,
);
