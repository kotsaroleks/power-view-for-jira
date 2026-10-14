import { useEffect, useState } from "react";
import type { WorkspaceContext } from "../workspace/WorkspaceContext";
import {
  emptyDraft,
  parseIssueKeys,
  qaComplete,
  readBoard,
  scopeComplete,
  stageFor,
  stages,
  updateDraft,
  type EstimationDraft,
  type ReleaseBoard,
} from "./workflow";
import "./estimation.css";

export function EstimationBoard({ workspace }: { workspace: WorkspaceContext }) {
  const storageKey = `power-view:estimation:v1:${workspace.jiraBaseUrl}:${workspace.board.id}`;
  const [board, setBoard] = useState<ReleaseBoard>(() => {
    try {
      return readBoard(localStorage.getItem(storageKey));
    } catch {
      return readBoard(null);
    }
  });
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(board));
      setStorageError("");
    } catch {
      setStorageError(
        "Changes could not be saved on this device. Export the handoff before leaving.",
      );
    }
  }, [board, storageKey]);
  const issues = new Map(workspace.issues.map((issue) => [issue.key, issue]));
  const draft = selected ? (board.drafts[selected] ?? emptyDraft()) : undefined;
  const issue = selected ? issues.get(selected) : undefined;
  const edit = <K extends keyof EstimationDraft>(field: K, value: EstimationDraft[K]) => {
    if (!selected) return;
    setBoard((previous) => ({
      ...previous,
      drafts: {
        ...previous.drafts,
        [selected]: updateDraft(previous.drafts[selected] ?? emptyDraft(), field, value),
      },
    }));
  };
  const importKeys = (text: string) => {
    const keys = parseIssueKeys(text);
    if (!keys.length) {
      setNotice("No Jira issue keys found. Use keys such as PROJECT-123.");
      return;
    }
    const added = keys.filter((key) => !board.keys.includes(key));
    setBoard((previous) => ({
      ...previous,
      keys: [...new Set([...previous.keys, ...keys])],
      drafts: {
        ...Object.fromEntries(added.map((key) => [key, emptyDraft()])),
        ...previous.drafts,
      },
    }));
    const missing = keys.filter((key) => !issues.has(key));
    setNotice(
      `${added.length} issues added. ${keys.length - added.length} already on the board.${missing.length ? ` Details unavailable in the loaded workspace: ${missing.join(", ")}.` : ""}`,
    );
    setInput("");
  };
  const importHandoff = (text: string) => {
    try {
      const metadata: unknown = JSON.parse(text);
      if (!metadata || typeof metadata !== "object") throw new Error("Invalid handoff");
      const data = metadata as Record<string, unknown>;
      if (
        data.version !== 1 ||
        data.boardId !== workspace.board.id ||
        data.jiraBaseUrl !== workspace.jiraBaseUrl ||
        !Array.isArray(data.keys) ||
        typeof data.release !== "string" ||
        !data.drafts ||
        typeof data.drafts !== "object"
      ) {
        setNotice("Use a version 1 handoff exported from this Jira instance and board.");
        return;
      }
      const imported = readBoard(text);
      const conflicts = imported.keys.filter((key) => board.keys.includes(key));
      if (
        conflicts.length &&
        !window.confirm(
          `Replace saved drafts for ${conflicts.length} existing issues with the imported handoff?`,
        )
      )
        return;
      setBoard((previous) => ({
        release: imported.release,
        keys: [...new Set([...previous.keys, ...imported.keys])],
        drafts: { ...previous.drafts, ...imported.drafts },
      }));
      setNotice(`Imported handoff for ${imported.keys.length} issues.`);
    } catch {
      setNotice("Could not read the handoff. Choose an exported JSON handoff.");
    }
  };
  const exportBoard = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            boardId: workspace.board.id,
            jiraBaseUrl: workspace.jiraBaseUrl,
            ...board,
            issues: board.keys.map((key) => ({
              key,
              summary: issues.get(key)?.summary ?? "",
              stage: stageFor(board.drafts[key] ?? emptyDraft()),
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "release-estimation-handoff.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const textField = (
    field: keyof EstimationDraft,
    label: string,
    placeholder = "",
    multiline = true,
  ) => (
    <label className="estimation-field">
      {label}
      {multiline ? (
        <textarea
          value={String(draft?.[field] ?? "")}
          placeholder={placeholder}
          onChange={(event) => edit(field, event.target.value)}
          rows={3}
        />
      ) : (
        <input
          value={String(draft?.[field] ?? "")}
          placeholder={placeholder}
          onChange={(event) => edit(field, event.target.value)}
        />
      )}
    </label>
  );
  return (
    <div className="estimation-workspace">
      <div className="estimation-intro">
        <div>
          <p className="report-eyebrow">RELEASE PREPARATION</p>
          <h1>Estimation board</h1>
          <p>Client scope → Tech Lead → Product Manager → QA Lead → Ready to dev</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={exportBoard}
          disabled={!board.keys.length}
        >
          Export handoff
        </button>
      </div>
      <p className="estimation-local-note">
        Drafts are saved on this device for {workspace.board.name}. Share the exported
        handoff with your leads; they can upload it here to continue. Estimates, subtasks,
        and readiness do not update Jira.
      </p>
      {storageError && <p role="alert">{storageError}</p>}
      <section className="estimation-import" aria-label="Release scope import">
        <label className="estimation-field">
          Release name
          <input
            value={board.release}
            onChange={(event) => setBoard({ ...board, release: event.target.value })}
            placeholder="e.g. Release 8.2"
          />
        </label>
        <label className="estimation-field">
          Client issue list
          <textarea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste Jira keys, URLs, or CSV rows: PROJECT-123, PROJECT-124"
          />
        </label>
        <div className="estimation-import-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => importKeys(input)}
          >
            Add to release
          </button>
          <label className="estimation-file">
            Upload list / handoff
            <input
              type="file"
              accept=".csv,.txt,.tsv,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void (async () => {
                  try {
                    const text = await file.text();
                    if (file.name.toLowerCase().endsWith(".json")) importHandoff(text);
                    else importKeys(text);
                  } catch {
                    setNotice("Could not read the file. Paste the issue list instead.");
                  }
                })();
              }}
            />
          </label>
        </div>
      </section>
      {notice && <p role="status">{notice}</p>}
      <div className="estimation-summary">
        <span>
          <strong>{board.keys.length}</strong> in release
        </span>
        <span>
          <strong>
            {board.keys.reduce((total, key) => {
              const days = Number(board.drafts[key]?.days);
              return total + (Number.isFinite(days) && days > 0 ? days : 0);
            }, 0)}
          </strong>{" "}
          estimated dev days
        </span>
        <span>
          <strong>
            {
              board.keys.filter(
                (key) => stageFor(board.drafts[key] ?? emptyDraft()) === "Ready to dev",
              ).length
            }
          </strong>{" "}
          ready
        </span>
        <label>
          Search issues
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Key or summary"
          />
        </label>
      </div>
      {workspace.truncated && (
        <p>
          Workspace issue loading was truncated. Imported keys without loaded details
          remain visible.
        </p>
      )}
      <div className="estimation-columns">
        {stages.map((stage, index) => {
          const keys = board.keys.filter(
            (key) => stageFor(board.drafts[key] ?? emptyDraft()) === stage,
          );
          return (
            <section
              className={`estimation-column estimation-stage-${index}`}
              key={stage}
              aria-label={stage}
            >
              <h2>
                <span>{index + 1}</span>
                {stage}
                <small>{keys.length}</small>
              </h2>
              <p>
                {
                  [
                    "Estimate days and decompose work",
                    "Answer open product questions",
                    "Confirm the final scope",
                    "Define tests and submit test data",
                    "Prepared for development",
                  ][index]
                }
              </p>
              {keys
                .filter((key) =>
                  `${key} ${issues.get(key)?.summary ?? ""}`
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((key) => (
                  <button
                    type="button"
                    className="estimation-card"
                    key={key}
                    onClick={() => setSelected(key)}
                    aria-pressed={selected === key}
                  >
                    <strong>{key}</strong>
                    <span>{issues.get(key)?.summary ?? "Issue details not loaded"}</span>
                    <small>{board.drafts[key]?.techLead || "Tech Lead unassigned"}</small>
                    {board.drafts[key]?.days && (
                      <small>{board.drafts[key]?.days} dev days</small>
                    )}
                  </button>
                ))}
              {!keys.length && (
                <div className="estimation-empty">No issues at this stage</div>
              )}
            </section>
          );
        })}
      </div>
      {!board.keys.length && (
        <p className="estimation-empty">
          Upload the client’s release list to begin estimation.
        </p>
      )}
      {selected && draft && (
        <section className="estimation-detail" aria-labelledby="estimation-detail-title">
          <div className="estimation-detail-heading">
            <div>
              <p className="report-eyebrow">{stageFor(draft)}</p>
              <h2 id="estimation-detail-title">
                {selected} · {issue?.summary ?? "Issue details not loaded"}
              </h2>
              {issue && (
                <a href={issue.browseUrl} target="_blank" rel="noreferrer">
                  Open in Jira ↗
                </a>
              )}
            </div>
            <div className="estimation-import-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setSelected(undefined)}
              >
                Close details
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Remove ${selected} and its preparation draft from this release?`,
                    )
                  )
                    return;
                  setBoard((previous) => {
                    const drafts = { ...previous.drafts };
                    delete drafts[selected];
                    return {
                      ...previous,
                      keys: previous.keys.filter((key) => key !== selected),
                      drafts,
                    };
                  });
                  setSelected(undefined);
                }}
              >
                Remove from release
              </button>
            </div>
          </div>
          <div className="estimation-detail-grid">
            <fieldset>
              <legend>1. Tech Lead estimation</legend>
              {textField("techLead", "Tech Lead", "Name", false)}
              <label className="estimation-field">
                Estimate (dev days)
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={draft.days}
                  onChange={(event) => edit("days", event.target.value)}
                />
              </label>
              {textField(
                "decomposition",
                "Subtask decomposition",
                "One subtask per line, with its estimate and expected result",
              )}
              {textField(
                "questions",
                "Questions for Product Manager",
                "Optional: clarify requirements, acceptance criteria, or dependencies",
              )}
              {textField("answers", "Product Manager answers")}
              <label className="estimation-check">
                <input
                  type="checkbox"
                  checked={draft.questionsResolved}
                  onChange={(event) => edit("questionsResolved", event.target.checked)}
                  disabled={!draft.questions.trim() || !draft.answers.trim()}
                />
                All product questions resolved
              </label>
              {textField("scope", "Final scope / acceptance criteria")}
              <label className="estimation-check">
                <input
                  type="checkbox"
                  checked={draft.scopeConfirmed}
                  disabled={!scopeComplete(draft)}
                  onChange={(event) => edit("scopeConfirmed", event.target.checked)}
                />
                Confirm final scope
              </label>
              <p className="estimation-hint">
                Requires a Tech Lead, positive day estimate, decomposition, final scope,
                and answers to any questions. Editing these details reopens scope and QA
                approval.
              </p>
            </fieldset>
            <fieldset disabled={!draft.scopeConfirmed || !scopeComplete(draft)}>
              <legend>2. QA Lead preparation</legend>
              {textField("qaLead", "QA Lead", "Name", false)}
              {textField(
                "environment",
                "Test environment",
                "Environment, version, access, and dependencies",
              )}
              {textField(
                "conditions",
                "Test conditions",
                "Configuration, prerequisites, feature flags, and constraints",
              )}
              {textField(
                "testPlan",
                "Test plan",
                "Scenarios, acceptance checks, regression scope, and expected results",
              )}
              {textField(
                "testData",
                "Test data for developer",
                "Fixtures, setup instructions, or links to test datasets",
              )}
              <label className="estimation-check">
                <input
                  type="checkbox"
                  checked={draft.qaSubmitted}
                  disabled={!qaComplete(draft)}
                  onChange={(event) => {
                    edit("qaSubmitted", event.target.checked);
                    if (!event.target.checked) edit("ready", false);
                  }}
                />
                Submit QA plan and test data
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!qaComplete(draft) || !draft.qaSubmitted || draft.ready}
                onClick={() => edit("ready", true)}
              >
                {draft.ready ? "Ready to dev ✓" : "Mark ready for development"}
              </button>
              <p className="estimation-hint">
                QA preparation opens after final scope confirmation. All QA fields and
                submission are required for readiness. This marks readiness in the local
                board.
              </p>
            </fieldset>
          </div>
        </section>
      )}
    </div>
  );
}
