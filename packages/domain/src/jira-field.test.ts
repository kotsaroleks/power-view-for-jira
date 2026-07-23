import { describe, expect, it } from "vitest";

import {
  rankDateFieldCandidates,
  validateFieldMapping,
  type JiraField,
} from "./jira-field";

const fields: JiraField[] = [
  {
    id: "customfield_10010",
    name: "Planned Start",
    custom: true,
    schema: { type: "date" },
    clauseNames: ["Planned Start"],
  },
  {
    id: "customfield_10011",
    name: "Target start",
    custom: true,
    schema: { type: "datetime" },
    clauseNames: ["Target start"],
  },
  {
    id: "duedate",
    name: "Due date",
    custom: false,
    schema: { type: "date", system: "duedate" },
    clauseNames: ["due"],
  },
  {
    id: "summary",
    name: "Start notes",
    custom: false,
    schema: { type: "string", system: "summary" },
    clauseNames: ["summary"],
  },
];

describe("date field discovery", () => {
  it("ranks date candidates without silently selecting string lookalikes", () => {
    expect(rankDateFieldCandidates(fields, "start")).toEqual([
      expect.objectContaining({ id: "customfield_10010", confidence: 0.96 }),
      expect.objectContaining({ id: "customfield_10011", confidence: 0.93 }),
    ]);
    expect(rankDateFieldCandidates(fields, "end")[0]).toMatchObject({
      id: "duedate",
      confidence: 0.98,
    });
  });

  it("rejects stale, non-date, and duplicate mappings", () => {
    expect(
      validateFieldMapping(
        {
          startDateFieldId: "summary",
          endDateFieldId: "summary",
          hierarchyFieldId: "missing",
        },
        fields,
      ),
    ).toEqual([
      "Start date must use a Jira date or date-time field.",
      "End date must use a Jira date or date-time field.",
      "Start and end dates must use different fields.",
      "Hierarchy field is no longer available in Jira.",
    ]);
  });
});
