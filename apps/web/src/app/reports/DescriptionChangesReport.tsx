import { useCallback, useEffect, useRef, useState } from "react";
import {
  latestDescriptionReportDate,
  shiftDescriptionDate,
  type DescriptionChangeReport,
} from "@power-view/domain";
import { collectDescriptionChangeReport, type JiraClient } from "@power-view/jira-client";
import "./description-report.css";

export function DescriptionChangesReport({
  client,
  baseUrl,
  boardId,
}: {
  client: JiraClient;
  baseUrl: string;
  boardId: string;
}) {
  const [date, setDate] = useState(() => latestDescriptionReportDate());
  const [report, setReport] = useState<DescriptionChangeReport>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const invalidate = useCallback(() => {
    epoch.current++;
    pending.current?.abort();
  }, []);
  useEffect(() => {
    invalidate();
    setReport(undefined);
    setError("");
    setProgress("");
    setBusy(false);
    return invalidate;
  }, [client, baseUrl, boardId, date, invalidate]);
  async function generate() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const id = ++epoch.current;
    setBusy(true);
    setError("");
    setReport(undefined);
    try {
      const result = await collectDescriptionChangeReport({
        client,
        jiraBaseUrl: baseUrl,
        boardId,
        date,
        signal: controller.signal,
        onProgress: (message) => {
          if (epoch.current === id) setProgress(message);
        },
      });
      if (epoch.current === id && !controller.signal.aborted) setReport(result);
    } catch (cause) {
      if (epoch.current === id && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not read the description changes.",
        );
    } finally {
      if (epoch.current === id) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  return (
    <section className="description-report" aria-label="Description changes report">
      <h2>Description changes</h2>
      <p>
        See which issue descriptions changed and who edited them. Each period ends at
        21:00 Kyiv.
      </p>
      <div className="description-report-controls">
        <label>
          Report date
          <input
            type="date"
            value={date}
            max={latestDescriptionReportDate()}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={busy || !date}
          onClick={() => {
            void generate();
          }}
        >
          Preview description changes
        </button>
        {busy ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              epoch.current++;
              pending.current?.abort();
              setBusy(false);
              setProgress("");
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
      <p className="description-report-note">
        {date
          ? `${shiftDescriptionDate(date, -1)} 21:00 — ${date} 21:00 · Europe/Kyiv`
          : "Select a date."}{" "}
        This preview sends no messages to Google Chat.
      </p>
      {busy ? <p role="status">{progress || "Reading Jira…"}</p> : null}
      {error ? <p role="alert">{error} No complete report was generated.</p> : null}
      {report ? (
        <>
          <h3>{report.boardName}</h3>
          <p>
            Changed issues: {report.changedIssueCount} · Edits: {report.changeCount}
          </p>
          {report.changedIssueCount === 0 ? (
            <p>No issue descriptions changed during this period.</p>
          ) : (
            <div className="description-report-table">
              <table>
                <thead>
                  <tr>
                    <th>Issue and hierarchy</th>
                    <th>Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr
                      key={row.issueId}
                      className={
                        row.contextOnly ? "description-report-context" : undefined
                      }
                    >
                      <td>
                        <div style={{ paddingInlineStart: row.depth * 18 }}>
                          {row.depth ? "↳ " : ""}
                          <a
                            href={`${report.jiraBaseUrl}/browse/${encodeURIComponent(row.issueKey)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.issueKey}
                          </a>{" "}
                          · {row.issueType}
                          <br />
                          {row.summary}
                        </div>
                      </td>
                      <td>
                        {row.contextOnly
                          ? "— (context)"
                          : row.authors.map((author) => author.displayName).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
