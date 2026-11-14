/* global console, Response, URL */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "./worker.mjs";

const config = JSON.parse(
  readFileSync(new URL("./wrangler.json", import.meta.url), "utf8"),
);
const env = { ...config.vars, GITHUB_ACTIONS_TOKEN: "fixture-token" };
const winterSlot = { scheduledTime: Date.parse("2026-11-12T22:05:00Z") };

test("the configured UTC hours dispatch once per Kyiv day across both clock changes", async (t) => {
  const dispatch = t.mock.method(globalThis, "fetch", () =>
    Response.json({ workflow_run_id: 123 }),
  );
  const log = t.mock.method(console, "log", () => {});
  const [cron] = config.triggers.crons;
  const [minute, hours] = cron.split(" ");
  for (const [date, expectedHour] of [
    ["2026-03-28", "22"],
    ["2026-03-29", "21"],
    ["2026-10-24", "21"],
    ["2026-10-25", "22"],
    ["2026-11-12", "22"],
  ]) {
    for (const hour of hours.split(",")) {
      const scheduledTime = Date.parse(`${date}T${hour}:${minute.padStart(2, "0")}:00Z`);
      await worker.scheduled({ scheduledTime }, env);
    }
    assert.equal(dispatch.mock.callCount(), 1, date);
    assert.deepEqual(JSON.parse(dispatch.mock.calls[0].arguments[1].body), {
      ref: "main",
      inputs: { mode: "deliver" },
    });
    assert.deepEqual(log.mock.calls[0].arguments[1], {
      mode: "deliver",
      scheduledAt: `${date}T${expectedHour}:05:00.000Z`,
      runId: 123,
    });
    dispatch.mock.resetCalls();
    log.mock.resetCalls();
  }
});

test("check mode can verify the private workflow outside the delivery window", async (t) => {
  const dispatch = t.mock.method(globalThis, "fetch", () =>
    Response.json({ workflow_run_id: 123 }),
  );
  t.mock.method(console, "log", () => {});
  await worker.scheduled(
    { scheduledTime: Date.parse("2026-11-12T14:30:00Z") },
    { ...env, REPORT_MODE: "check" },
  );
  assert.equal(dispatch.mock.callCount(), 1);
  const [url, request] = dispatch.mock.calls[0].arguments;
  assert.equal(
    url,
    "https://api.github.com/repos/kotsaroleks/power-view-report-automation/actions/workflows/410459071/dispatches",
  );
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "manual");
  assert.equal(request.headers.Authorization, "Bearer fixture-token");
  assert.equal(request.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.deepEqual(JSON.parse(request.body), { ref: "main", inputs: { mode: "check" } });
});

test("missing credentials or an unknown mode cannot dispatch", async (t) => {
  const dispatch = t.mock.method(globalThis, "fetch");
  await assert.rejects(
    worker.scheduled(winterSlot, config.vars),
    /Missing GITHUB_ACTIONS_TOKEN/,
  );
  await assert.rejects(
    worker.scheduled(winterSlot, { ...env, REPORT_MODE: "" }),
    /Set REPORT_MODE/,
  );
  assert.equal(dispatch.mock.callCount(), 0);
});

test("a failed or unconfirmed dispatch does not log success", async (t) => {
  const dispatch = t.mock.method(
    globalThis,
    "fetch",
    () => new Response(null, { status: 403 }),
  );
  const log = t.mock.method(console, "log", () => {});
  await assert.rejects(worker.scheduled(winterSlot, env), /HTTP 403/);

  dispatch.mock.mockImplementation(() => Response.redirect("https://example.com", 302));
  await assert.rejects(worker.scheduled(winterSlot, env), /HTTP 302/);
  assert.equal(dispatch.mock.callCount(), 2);

  dispatch.mock.mockImplementation(() => Response.json({}));
  await assert.rejects(worker.scheduled(winterSlot, env), /did not return a run ID/);

  dispatch.mock.mockImplementation(() =>
    Promise.reject(new Error("Network unavailable")),
  );
  await assert.rejects(
    worker.scheduled(winterSlot, env),
    /Could not confirm the workflow dispatch/,
  );
  assert.equal(log.mock.callCount(), 0);
});
