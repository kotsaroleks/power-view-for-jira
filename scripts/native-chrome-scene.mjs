// Use the actual production-browser fixture data for matching native renders.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { weeklyRows } from "../apps/web/src/app/timesheet/weekly-row-model.ts";
const source = readFileSync("e2e/timesheet-production.spec.ts", "utf8");
const start = source.indexOf("const sampleIssues = ");
const end = source.indexOf("\ntest(", start);
if (start < 0 || end < 0)
  throw new Error("Cannot locate the original production fixture.");
const { sampleIssues, allIssues } = Function(
  stripTypeScriptTypes(source.slice(start, end)) +
    "\nreturn { sampleIssues, allIssues };",
)();
const anchor = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const user = {
  accountId: "fixture-author",
  displayName: "Demo user · TEST DATA",
  timeZone: "Europe/Kyiv",
};
const worklogs = sampleIssues.map((issue, index) => ({
  id: String(100 + index),
  issueId: issue.id,
  author: user,
  started: `${anchor}T09:00:00.000+0200`,
  timeSpentSeconds: 1800 * (index + 1),
  updated: "2026-10-29T12:00:00.000Z",
  comment: {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Test fixture worklog" }] },
    ],
  },
}));
const metadata = allIssues.map((issue) => ({
  id: issue.id,
  key: issue.key,
  summary: issue.fields.summary,
  hierarchyLevel: issue.fields.issuetype.hierarchyLevel,
  assigneeId: issue.fields.assignee?.accountId,
  parentKey: issue.fields.parent?.key,
}));
const pins = ["POWER-70"],
  priorities = ["LBR-68393"];
const rows = metadata
  .map((issue) => ({
    issue,
    cells: new Map(
      worklogs.some((log) => log.issueId === issue.id)
        ? [[anchor, worklogs.filter((log) => log.issueId === issue.id)]]
        : [],
    ),
  }))
  .sort((a, b) => a.issue.key.localeCompare(b.issue.key, undefined, { numeric: true }));
const expectedRows = weeklyRows({
  rows,
  boardIssues: metadata,
  accountId: user.accountId,
  pins,
  priorities,
  expanded: [],
  search: "",
}).map((row) => row.issue.key);
const scene = {
  origin: "https://fixture.atlassian.net",
  anchor,
  user,
  issues: allIssues,
  searchIssues: sampleIssues,
  worklogs,
  boardID: "7",
  boardName: "Team board",
  pins,
  priorities,
  expectedRows,
  expectedSeconds: worklogs.reduce((sum, log) => sum + log.timeSpentSeconds, 0),
  source: "e2e/timesheet-production.spec.ts · timesheet-agreed-groups-1440.png state",
};
const target = process.argv[2] ?? "/private/tmp/power-view-native-chrome-scene.json";
writeFileSync(target, JSON.stringify(scene, null, 2) + "\n");
console.log(
  `Saved shared Chrome/native scene: ${scene.issues.length} issues, ${scene.worklogs.length} own worklogs, ${scene.expectedSeconds} seconds.`,
);
