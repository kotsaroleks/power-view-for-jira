import { describe, expect, it } from "vitest";

import {
  isExactHttpsOriginPattern,
  normalizeHostPermissionPattern,
} from "./origin-permission";

describe("host permission normalization", () => {
  it("reduces user input to one exact HTTPS host pattern", () => {
    expect(normalizeHostPermissionPattern("jira.example.com/projects/POWER")).toBe(
      "https://jira.example.com/*",
    );
  });

  it("rejects insecure, credentialed, wildcard, and custom-port URLs", () => {
    expect(() => normalizeHostPermissionPattern("http://jira.example.com")).toThrow(
      "requires HTTPS",
    );
    expect(() =>
      normalizeHostPermissionPattern("https://user:secret@jira.example.com"),
    ).toThrow("credentials");
    expect(() => normalizeHostPermissionPattern("https://*.example.com")).toThrow(
      "Wildcard",
    );
    expect(() => normalizeHostPermissionPattern("https://jira.example.com:8443")).toThrow(
      "ports",
    );
  });

  it("recognizes only normalized patterns", () => {
    expect(isExactHttpsOriginPattern("https://jira.example.com/*")).toBe(true);
    expect(isExactHttpsOriginPattern("https://jira.example.com/projects/POWER")).toBe(
      false,
    );
  });
});
