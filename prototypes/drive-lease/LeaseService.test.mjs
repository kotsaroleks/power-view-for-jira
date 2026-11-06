import { URL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
function server() {
  let actor = "tl@example.test",
    now = 0,
    requestSequence = 0,
    held = false;
  let content = JSON.stringify({
    schemaVersion: 1,
    generation: 0,
    revision: 0,
    document: {},
    lease: null,
    receipts: [],
  });
  const values = new Map([
    ["MEMBERS", '["tl@example.test","qa@example.test"]'],
    ["RELEASE_FILE_ID", "fixture"],
  ]);
  const context = vm.createContext({
    Session: { getActiveUser: () => ({ getEmail: () => actor }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => values.get(k),
        setProperty: (k, v) => values.set(k, v),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(held, false);
          held = true;
        },
        releaseLock: () => {
          held = false;
        },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, value) => crypto.createHash("sha256").update(value).digest(),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
    },
    Date: { now: () => now },
    DriveApp: {
      getFileById: () => ({
        getBlob: () => ({ getDataAsString: () => content }),
        setContent: (value) => {
          assert.equal(held, true);
          content = value;
        },
      }),
    },
  });
  vm.runInContext(
    fs.readFileSync(new URL("./LeaseService.js", import.meta.url), "utf8"),
    context,
  );
  return {
    call: (req) => {
      const request = {
        requestID: String(++requestSequence),
        ...(req.action === "acquire" ? { token: crypto.randomUUID() } : {}),
        ...req,
      };
      return { ...context.releaseOperation(request), token: request.token };
    },
    actor: (value) => {
      actor = value;
    },
    advance: (ms) => {
      now += ms;
    },
    content: () => content,
  };
}
test("one lease winner, expiry and stale editor fencing through Drive write", () => {
  const s = server();
  const a = s.call({ action: "acquire" });
  s.actor("qa@example.test");
  assert.throws(() => s.call({ action: "acquire" }), /Busy/);
  s.advance(30 * 60 * 1000);
  const b = s.call({ action: "acquire" });
  s.actor("tl@example.test");
  assert.throws(
    () =>
      s.call({
        action: "saveAndRelease",
        token: a.token,
        revision: 0,
        document: { old: true },
      }),
    /Lease lost/,
  );
  s.actor("qa@example.test");
  assert.throws(
    () => s.call({ action: "saveAndRelease", token: b.token, revision: 9 }),
    /Revision conflict/,
  );
  s.call({
    action: "saveAndRelease",
    token: b.token,
    revision: 0,
    document: { fresh: true },
  });
  assert.deepEqual(JSON.parse(s.content()).document, { fresh: true });
  assert.throws(
    () => s.call({ action: "saveAndRelease", token: b.token, revision: 0 }),
    /Lease lost/,
  );
});
test("identity is server-derived and unknown actions cannot renew", () => {
  const s = server(),
    a = s.call({ action: "acquire" });
  assert.throws(() => s.call({ action: "poll", token: a.token }), /Unknown action/);
  s.actor("intruder@example.test");
  assert.throws(
    () => s.call({ action: "acquire", actor: "tl@example.test" }),
    /Forbidden/,
  );
});

test("uncertain save response is reconciled without a second revision", () => {
  const s = server(),
    a = s.call({ action: "acquire" });
  const request = {
    action: "saveAndRelease",
    token: a.token,
    revision: 0,
    document: { saved: true },
    requestID: "stable-save",
  };
  s.call(request);
  const repeated = s.call(request);
  assert.equal(repeated.revision, 1);
  assert.equal(JSON.parse(s.content()).revision, 1);
  assert.throws(
    () => s.call({ ...request, document: { different: true } }),
    /Request ID reused/,
  );
});

test("shared envelope and receipts never contain a raw lease secret", () => {
  const s = server(),
    a = s.call({ action: "acquire" });
  assert.equal(s.content().includes(a.token), false);
  s.call({ action: "activity", token: a.token });
  assert.equal(s.content().includes(a.token), false);
});
