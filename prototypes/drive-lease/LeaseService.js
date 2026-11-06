/* global Session, PropertiesService, Utilities, LockService, DriveApp */
/* Server-side candidate, not a deployed integration.
 * Every shared write must go through one Script deployment. Direct Drive edits bypass it.
 * RELEASE_FILE_ID and MEMBERS are server configuration; never accept a caller-supplied actor.
 * The release Drive file stores the entire envelope {document, revision, generation, lease, receipts}.
 * This removes the split commit between Drive document and ScriptProperties metadata.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Apps Script public entry point, exercised by the VM harness.
function releaseOperation(request) {
  const actor = Session.getActiveUser().getEmail();
  if (!actor) throw new Error("Authenticated Workspace identity required");
  const props = PropertiesService.getScriptProperties();
  if (!JSON.parse(props.getProperty("MEMBERS") || "[]").includes(actor))
    throw new Error("Forbidden");
  const fileId = props.getProperty("RELEASE_FILE_ID");
  if (!fileId) throw new Error("Release not configured");
  if (!request.requestID || typeof request.requestID !== "string")
    throw new Error("Request ID required");
  const digest = (value) =>
    Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value),
    );
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const file = DriveApp.getFileById(fileId);
    const state = JSON.parse(file.getBlob().getDataAsString());
    if (
      state.schemaVersion !== 1 ||
      !Number.isSafeInteger(state.revision) ||
      !Number.isSafeInteger(state.generation)
    )
      throw new Error("Invalid release envelope");
    const now = Date.now();
    const receipt = (state.receipts || []).find((item) => item.id === request.requestID);
    const signature = digest(
      JSON.stringify({
        action: request.action,
        token: request.token,
        revision: request.revision,
        document: request.document,
      }),
    );
    if (receipt) {
      if (receipt.actor !== actor || receipt.signature !== signature)
        throw new Error("Request ID reused");
      return receipt.response; // Reconcile an uncertain response, never repeat the write.
    }
    if (request.action === "read") {
      return {
        document: state.document,
        revision: state.revision,
        owner: state.lease && state.lease.expires > now ? state.lease.owner : null,
      };
    }
    if (request.action === "acquire") {
      if (state.lease && now < state.lease.expires) throw new Error("Busy");
      if (typeof request.token !== "string" || request.token.length < 32)
        throw new Error("Client lease secret required");
      state.generation += 1;
      state.lease = {
        owner: actor,
        tokenHash: digest(request.token),
        expires: now + 30 * 60 * 1000,
      };
    } else {
      if (
        !state.lease ||
        state.lease.owner !== actor ||
        state.lease.tokenHash !== digest(request.token || "") ||
        now >= state.lease.expires
      )
        throw new Error("Lease lost");
      if (request.action === "activity") {
        // Explicit foreground user interaction only; background polling calls read.
        state.lease.expires = now + 30 * 60 * 1000;
      } else if (request.action === "saveAndRelease") {
        if (state.revision !== request.revision) throw new Error("Revision conflict");
        if (!request.document || typeof request.document !== "object")
          throw new Error("Document required");
        state.document = request.document;
        state.revision += 1;
        state.lease = null;
      } else if (request.action === "release") {
        state.lease = null;
      } else throw new Error("Unknown action");
    }
    const response = {
      generation: state.generation,
      revision: state.revision,
      expires: state.lease ? state.lease.expires : null,
      serverTime: now,
    };
    // Only hashes are stored; the caller generates and privately retains its lease secret.
    // Replayed responses are historical receipts, not a claim that a lease is still active.
    const receiptResponse = {
      generation: response.generation,
      revision: response.revision,
      expires: response.expires,
      serverTime: response.serverTime,
    };
    state.receipts = (state.receipts || [])
      .concat([
        {
          id: request.requestID,
          actor: actor,
          signature: signature,
          response: receiptResponse,
        },
      ])
      .slice(-100);
    // One content update contains both data and commit metadata, inside the same server lock.
    file.setContent(JSON.stringify(state));
    return response;
  } finally {
    lock.releaseLock();
  }
}
