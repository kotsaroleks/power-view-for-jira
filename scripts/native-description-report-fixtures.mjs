import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../packages/domain/src/description-report.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { buildDescriptionChangeReport, descriptionReportPeriod } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const issue = (id, parent) => ({
  id,
  key: `TEST-${id}`,
  summary: `TEST DATA · Task ${id}`,
  browseUrl: `https://fixture.atlassian.net/browse/TEST-${id}`,
  issueType: { id: "1", name: parent ? "Subtask" : "Epic" },
  status: { name: "Open" },
  sprintIds: [],
  ...(parent ? { parentId: parent, parentKey: `TEST-${parent}` } : {}),
});
const event = (id, issueId, author, time = "2026-11-06T10:00:00Z") => ({
  id,
  issueId,
  issueKey: `TEST-${issueId}`,
  type: "description-changed",
  occurredAt: time,
  ...(author ? { actor: { id: author, displayName: author } } : {}),
});
const cases = [
  {
    name: "hierarchy-and-authors",
    issues: [issue("1"), issue("2", "1"), issue("3", "2"), issue("4", "1")],
    events: [event("a", "2", "Alice"), event("b", "3", "Bob"), event("c", "3", "Alice")],
  },
  { name: "empty", issues: [issue("1")], events: [] },
  {
    name: "boundaries",
    issues: [issue("1"), issue("2", "1")],
    events: [
      event("a", "2", "Alice", "2026-11-05T19:00:00Z"),
      event("b", "2", "Bob", "2026-11-06T19:00:00Z"),
    ],
  },
  { name: "unknown-editor", issues: [issue("1")], events: [event("a", "1", undefined)] },
];
const fixtures = cases.map((value) => {
  const input = {
    jiraBaseUrl: "https://fixture.atlassian.net",
    boardId: "7",
    boardName: "TEST DATA · Description report",
    period: descriptionReportPeriod("2026-11-06"),
    generatedAt: "2026-11-06T19:05:00.000Z",
    issues: value.issues,
    events: value.events,
  };
  return { name: value.name, input, expected: buildDescriptionChangeReport(input) };
});
await writeFile(
  new URL(
    "../apps/macos/Tests/PowerViewCoreTests/Fixtures/description-report-golden.json",
    import.meta.url,
  ),
  JSON.stringify(fixtures, null, 2) + "\n",
);
console.log(
  `Generated ${fixtures.length} description report fixtures from the current TypeScript implementation.`,
);
