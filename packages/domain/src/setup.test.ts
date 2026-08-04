import { describe, expect, it } from "vitest";

import { buildDefaultBoardJql, buildDefaultProjectJql, validateJqlInput } from "./setup";

describe("setup query helpers", () => {
  it("builds deterministic default project JQL", () => {
    expect(buildDefaultProjectJql("POWER_2")).toBe(
      'project = "POWER_2" ORDER BY Rank ASC',
    );
  });

  it("builds board-filtered default JQL", () => {
    expect(buildDefaultBoardJql("1296")).toBe("filter = 1296 ORDER BY Rank ASC");
  });

  it("rejects a project key that could change the JQL expression", () => {
    expect(() => buildDefaultProjectJql('POWER" OR project = OTHER')).toThrow(
      "valid Jira project key",
    );
  });

  it("validates empty and control-character JQL locally", () => {
    expect(validateJqlInput("  ")).toContain("Enter a JQL query before saving setup.");
    expect(validateJqlInput("project = POWER\u0000")).toContain(
      "JQL contains unsupported control characters.",
    );
  });
});
