import { describe, expect, it } from "vitest";
import type { WorklogPickerIssue } from "@power-view/jira-client";
import { testIssue, testLog } from "./test-fixtures";
import { weeklyRows } from "./weekly-row-model";

function issue(id: string, parentKey: string | null = null): WorklogPickerIssue {
  return {
    ...testIssue,
    id,
    key: `PV-${id}`,
    typeName: "Task",
    hierarchyLevel: 0,
    subtask: false,
    parentKey,
    assigneeId: null,
  };
}
function model(boardIssues: WorklogPickerIssue[], options = {}) {
  return weeklyRows({
    rows: boardIssues.map((value) => ({ issue: value, cells: new Map() })),
    boardIssues,
    accountId: "me",
    pins: [],
    priorities: [],
    expanded: [],
    search: "",
    ...options,
  });
}

describe("Weekly row presentation", () => {
  it("applies the agreed precedence once and retains priority descendants", () => {
    const epic = { ...issue("10"), hierarchyLevel: 1 };
    const child = { ...issue("11", epic.key), assigneeId: "me" };
    const pinned = issue("12", epic.key);
    const logged = issue("13", epic.key);
    const assigned = { ...issue("14"), assigneeId: "me" };
    const other = issue("15");
    const board = [epic, child, pinned, logged, assigned, other];
    const rows = board.map((value) => ({
      issue: value,
      cells: new Map(value === logged ? [["2026-11-02", [testLog()]]] : []),
    }));
    const result = model(board, {
      rows,
      pins: [pinned.key],
      priorities: [epic.key],
      expanded: [epic.key],
    });
    expect(result.map((row) => [row.issue.key, row.group])).toEqual([
      [pinned.key, 0],
      [logged.key, 1],
      [epic.key, 2],
      [child.key, 2],
      [assigned.key, 3],
      [other.key, 4],
    ]);
    expect(result.find((row) => row.issue.key === child.key)?.depth).toBe(1);
    expect(result.filter((row) => row.issue.key === pinned.key)).toHaveLength(1);
  });

  it("keeps assigned children visible while other descendants start collapsed", () => {
    const epic = { ...issue("10"), hierarchyLevel: 1 };
    const child = issue("11", epic.key);
    const assigned = { ...issue("12", epic.key), assigneeId: "me" };
    expect(model([epic, child, assigned]).map((row) => row.issue.key)).toEqual([
      assigned.key,
      epic.key,
    ]);
    expect(
      model([epic, child, assigned], { search: "  PV-11 " }).map((row) => row.issue.key),
    ).toEqual([child.key]);
  });

  it("keeps tasks reachable even when parent metadata contains a cycle", () => {
    const first = issue("1", "PV-2");
    const second = issue("2", "PV-1");
    const root = model([first, second]);
    expect(root).toHaveLength(1);
    expect(root[0]?.hasChildren).toBe(true);
    const expanded = model([first, second], { expanded: [root[0]!.issue.key] });
    expect(new Set(expanded.map((row) => row.issue.key))).toEqual(
      new Set(["PV-1", "PV-2"]),
    );
  });

  it("groups siblings of a pinned parent under one structural heading", () => {
    const parent = issue("1");
    const children = [issue("2", parent.key), issue("3", parent.key)];
    const result = model([parent, ...children], { pins: [parent.key] });
    expect(result.filter((row) => row.parentHeading)).toHaveLength(1);
    expect(result).toHaveLength(3);
  });
});
