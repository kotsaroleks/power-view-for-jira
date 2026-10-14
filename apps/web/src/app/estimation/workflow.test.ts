import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  parseIssueKeys,
  qaComplete,
  readBoard,
  scopeComplete,
  stageFor,
  updateDraft,
} from "./workflow";

const tech = {
  ...emptyDraft(),
  techLead: "Alex",
  days: "2.5",
  decomposition: "API: 1d\nUI: 1.5d",
  scope: "Validate the release selection",
};
const qa = {
  ...tech,
  scopeConfirmed: true,
  qaLead: "Sam",
  environment: "Staging v8",
  conditions: "Feature flag enabled",
  testPlan: "Check selected and unselected issues",
  testData: "Seed release fixtures",
  qaSubmitted: true,
  ready: true,
};

describe("release preparation gates", () => {
  it("requires complete technical work and positive finite days", () => {
    expect(stageFor(emptyDraft())).toBe("Tech estimation");
    for (const days of ["", "0", "-1", "Infinity", "abc"])
      expect(scopeComplete({ ...tech, days })).toBe(false);
    expect(stageFor(tech)).toBe("Scope confirmation");
  });
  it("blocks scope on unanswered product questions", () => {
    const draft = { ...tech, questions: "Which accounts?", questionsResolved: true };
    expect(stageFor(draft)).toBe("PM clarification");
    expect(scopeComplete(draft)).toBe(false);
    expect(scopeComplete({ ...draft, answers: "Enterprise accounts" })).toBe(true);
  });
  it("requires confirmed scope, all QA data and explicit submission for readiness", () => {
    expect(stageFor({ ...tech, scopeConfirmed: true })).toBe("QA preparation");
    expect(qaComplete({ ...qa, testData: " " })).toBe(false);
    expect(stageFor({ ...qa, testData: " " })).toBe("QA preparation");
    expect(stageFor({ ...qa, qaSubmitted: false })).toBe("QA preparation");
    expect(stageFor(qa)).toBe("Ready to dev");
  });
  it("invalidates scope and QA approval when technical requirements change", () => {
    const revised = updateDraft(qa, "decomposition", "Additional integration");
    expect(revised).toMatchObject({
      scopeConfirmed: false,
      qaSubmitted: false,
      ready: false,
    });
    expect(stageFor(revised)).toBe("Scope confirmation");
    expect(updateDraft(qa, "testData", "New fixtures")).toMatchObject({
      scopeConfirmed: true,
      qaSubmitted: false,
      ready: false,
    });
  });
  it("deduplicates keys from CSV, URLs, and pasted lists", () => {
    expect(
      parseIssueKeys(
        'key,summary\nPROJ-1,"First"\nhttps://jira.test/browse/proj-2 PROJ-1',
      ),
    ).toEqual(["PROJ-1", "PROJ-2"]);
  });
  it("validates persisted data and tolerates malformed storage", () => {
    expect(readBoard("broken")).toEqual({ release: "", keys: [], drafts: {} });
    expect(
      readBoard(
        JSON.stringify({
          release: "v8",
          keys: ["PROJ-1", 42, "invalid", "PROJ-1"],
          drafts: { "PROJ-1": { days: 3, ready: "yes", techLead: "Alex" } },
        }),
      ),
    ).toEqual({
      release: "v8",
      keys: ["PROJ-1"],
      drafts: { "PROJ-1": { ...emptyDraft(), techLead: "Alex" } },
    });
  });
});
