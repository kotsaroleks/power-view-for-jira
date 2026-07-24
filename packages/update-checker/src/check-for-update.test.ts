import { describe, expect, it, vi } from "vitest";

import { checkForUpdate } from "./check-for-update";

const CHECKED_AT = "2026-07-24T12:00:00.000Z";
const now = () => new Date(CHECKED_AT);

const baseInput = {
  token: "test-token",
  owner: "kotsaroleks",
  repo: "power-view-for-jira",
  branch: "main",
  currentCommitSha: "abc1234abc1234abc1234abc1234abc1234abcd",
  now,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("checkForUpdate", () => {
  it("returns token-missing without making a network call", async () => {
    const fetchImpl = vi.fn();

    const outcome = await checkForUpdate({ ...baseInput, token: undefined, fetchImpl });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: "token-missing",
      checkedAt: CHECKED_AT,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns check-failed without a network call when the build has no embedded commit", async () => {
    const fetchImpl = vi.fn();

    const outcome = await checkForUpdate({
      ...baseInput,
      currentCommitSha: null,
      fetchImpl,
    });

    expect(outcome).toMatchObject({ status: "check-failed" });
    expect(outcome.errorMessage).toMatch(/rebuild/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns up-to-date when the latest commit matches the current build", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sha: baseInput.currentCommitSha }));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: "up-to-date",
      checkedAt: CHECKED_AT,
      currentCommitSha: baseInput.currentCommitSha,
      latestCommitSha: baseInput.currentCommitSha,
    });
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      "https://api.github.com/repos/kotsaroleks/power-view-for-jira/commits/main",
    );
    expect(calledInit.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("returns update-available when the latest commit differs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sha: "newsha1234" }));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toMatchObject({
      status: "update-available",
      currentCommitSha: baseInput.currentCommitSha,
      latestCommitSha: "newsha1234",
    });
  });

  it.each([401, 403])("returns token-invalid on HTTP %i", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, status));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toMatchObject({ status: "token-invalid" });
  });

  it("returns check-failed on other non-2xx statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toMatchObject({ status: "check-failed" });
  });

  it("returns check-failed when the network call throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toMatchObject({ status: "check-failed" });
  });

  it("returns check-failed on a malformed response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ notSha: true }));

    const outcome = await checkForUpdate({ ...baseInput, fetchImpl });

    expect(outcome).toMatchObject({ status: "check-failed" });
  });
});
