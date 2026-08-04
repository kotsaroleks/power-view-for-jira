import {
  buildGanttScheduleModel,
  buildDefaultBoardJql,
  buildDefaultProjectJql,
  DEFAULT_DURATION_DAYS,
  rankDateFieldCandidates,
  validateFieldMapping,
  validateJqlInput,
  type FieldMapping,
  type DefaultDurationDays,
  type GanttScheduleModel,
  type IssueSearchResult,
  type JiraField,
  type NormalizedIssue,
  type JiraPageContext,
  type JiraProject,
  type PaginatedResult,
  type PageProgress,
} from "@power-view/domain";
import {
  createIssueLoadReportRequest,
  sendExtensionRequest,
  type ExtensionRuntime,
} from "@power-view/extension-messaging";
import {
  createJiraClient,
  isJiraClientError,
  RuntimeJiraTransport,
  type JiraClient,
} from "@power-view/jira-client";
import type { SettingsStore } from "@power-view/storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SetupPanelProps {
  context: JiraPageContext;
  runtime: ExtensionRuntime;
  settingsStore?: SettingsStore;
  onDiagnosticsChanged?: () => void;
  onScheduleReady?: (schedule: ReadyGanttSchedule | undefined) => void;
  onSetupComplete?: (schedule: ReadyGanttSchedule) => void;
}

export interface ReadyGanttSchedule {
  model: GanttScheduleModel;
  issues: NormalizedIssue[];
  queryKey: string;
  jiraBaseUrl: string;
  projectKey: string;
  projectName: string;
  jql: string;
  loadedAt: string;
  truncated: boolean;
  sprintDataAvailable: boolean;
  storyPointsDataAvailable: boolean;
  editing: {
    client: JiraClient;
    fieldMapping: FieldMapping;
    refresh: () => Promise<void>;
  };
}

type LoadState = "idle" | "loading" | "ready" | "error";
type IssueLoadState = "idle" | "loading" | "ready" | "error";

const EMPTY_PROJECT_PAGE: PaginatedResult<JiraProject> = {
  values: [],
  startAt: 0,
  maxResults: 25,
  total: 0,
  isLast: true,
};

function fieldOptionLabel(field: JiraField): string {
  const type = field.schema?.type ? ` · ${field.schema.type}` : "";
  return `${field.name}${type} · ${field.id}`;
}

function inferredReportFieldMapping(fields: JiraField[]): FieldMapping {
  const normalizedName = (field: JiraField) => field.name.trim().toLowerCase();
  const sprint = fields.find(
    (field) =>
      normalizedName(field) === "sprint" ||
      field.schema?.custom?.toLowerCase().includes("gh-sprint"),
  );
  const storyPoints = fields.find((field) =>
    ["story points", "story point estimate"].includes(normalizedName(field)),
  );
  return {
    ...(sprint ? { sprintFieldId: sprint.id } : {}),
    ...(storyPoints ? { storyPointsFieldId: storyPoints.id } : {}),
  };
}

export function SetupPanel({
  context,
  runtime,
  settingsStore,
  onDiagnosticsChanged,
  onScheduleReady,
  onSetupComplete,
}: SetupPanelProps) {
  const client = useMemo(
    () =>
      createJiraClient(new RuntimeJiraTransport({ runtime }), {
        baseUrl: context.baseUrl,
        deploymentType: context.deploymentType,
      }),
    [context.baseUrl, context.deploymentType, runtime],
  );
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string>();
  const [projectSearch, setProjectSearch] = useState(context.projectKey ?? "");
  const [projectPage, setProjectPage] =
    useState<PaginatedResult<JiraProject>>(EMPTY_PROJECT_PAGE);
  const [pageStart, setPageStart] = useState(0);
  const [fields, setFields] = useState<JiraField[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [jql, setJql] = useState("");
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [defaultDurations, setDefaultDurations] = useState<DefaultDurationDays>({
    ...DEFAULT_DURATION_DAYS,
  });
  const [recentJql, setRecentJql] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const requestAbort = useRef<AbortController | undefined>(undefined);
  const issueAbort = useRef<AbortController | undefined>(undefined);
  const [issueLoadState, setIssueLoadState] = useState<IssueLoadState>("idle");
  const [issueProgress, setIssueProgress] = useState<PageProgress>();
  const [issueResult, setIssueResult] = useState<IssueSearchResult>();
  const [issueLoadedAt, setIssueLoadedAt] = useState<string>();
  const [issueLoadError, setIssueLoadError] = useState<string>();
  const scheduleModel = useMemo(
    () =>
      issueResult
        ? buildGanttScheduleModel(issueResult.values, { defaultDurations })
        : undefined,
    [defaultDurations, issueResult],
  );
  const scheduleQueryKey = `${context.baseUrl}\n${selectedProjectKey}\n${jql.trim()}`;

  const selectedProject = projectPage.values.find(
    (project) => project.key === selectedProjectKey,
  );
  const startCandidates = useMemo(
    () => rankDateFieldCandidates(fields, "start"),
    [fields],
  );
  const endCandidates = useMemo(() => rankDateFieldCandidates(fields, "end"), [fields]);
  const dateFields = useMemo(
    () =>
      fields
        .filter((field) => {
          const type = field.schema?.type?.toLowerCase();
          return type === "date" || type === "datetime";
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [fields],
  );
  const allFields = useMemo(
    () => [...fields].sort((left, right) => left.name.localeCompare(right.name)),
    [fields],
  );

  const applyProjectPage = useCallback(
    (page: PaginatedResult<JiraProject>, preferredProjectKey?: string) => {
      setProjectPage(page);
      setSelectedProjectKey((current) => {
        if (page.values.some((project) => project.key === current)) {
          return current;
        }
        const preferred = page.values.find(
          (project) => project.key === preferredProjectKey,
        );
        return (
          preferred?.key ?? (page.values.length === 1 ? (page.values[0]?.key ?? "") : "")
        );
      });
    },
    [],
  );

  const loadMetadata = async () => {
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    setLoadState("loading");
    setLoadError(undefined);
    setValidationErrors([]);

    try {
      const [projects, loadedFields] = await Promise.all([
        client.getProjects(
          {
            query: projectSearch,
            startAt: 0,
            maxResults: 25,
          },
          controller.signal,
        ),
        client.getFields(controller.signal),
      ]);
      if (controller.signal.aborted) {
        return;
      }
      setPageStart(0);
      applyProjectPage(projects, context.projectKey);
      setFields(loadedFields);
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setLoadState("error");
      setLoadError(
        isJiraClientError(error)
          ? error.appError.message
          : "Power View could not load Jira projects and fields.",
      );
    }
  };

  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client
        .getProjects(
          { query: projectSearch, startAt: pageStart, maxResults: 25 },
          controller.signal,
        )
        .then(
          (page) => applyProjectPage(page, context.projectKey),
          (error: unknown) => {
            if (!controller.signal.aborted) {
              setLoadError(
                isJiraClientError(error)
                  ? error.appError.message
                  : "Power View could not search Jira projects.",
              );
            }
          },
        );
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [applyProjectPage, client, context.projectKey, loadState, pageStart, projectSearch]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    if (!settingsStore) {
      setRecentJql([]);
      setFieldMapping({});
      setDefaultDurations({ ...DEFAULT_DURATION_DAYS });
      setJql(buildDefaultProjectJql(selectedProject.key));
      setValidationErrors([]);
      setSaveStatus("idle");
      issueAbort.current?.abort();
      client.clearIssueCache();
      setIssueLoadState("idle");
      setIssueResult(undefined);
      return;
    }

    let isCurrent = true;
    void Promise.all([
      settingsStore.getSetup(context.baseUrl, selectedProject.key),
      settingsStore.getRecentJql(context.baseUrl, selectedProject.key),
      context.boardId
        ? client.getBoardConfiguration(context.boardId).catch(() => undefined)
        : Promise.resolve(undefined),
    ])
      .then(([storedSetup, storedRecentJql, boardConfiguration]) => {
        if (!isCurrent) {
          return;
        }
        const projectJql = buildDefaultProjectJql(selectedProject.key);
        const boardJql = boardConfiguration?.filterId
          ? buildDefaultBoardJql(boardConfiguration.filterId)
          : undefined;
        const useStoredSetup =
          storedSetup &&
          (!context.boardId ||
            storedSetup.boardId === context.boardId ||
            (storedSetup.boardId === undefined && storedSetup.jql !== projectJql));
        setRecentJql(storedRecentJql);
        setFieldMapping({
          ...inferredReportFieldMapping(fields),
          ...(storedSetup?.fieldMapping ?? {}),
        });
        setDefaultDurations(
          storedSetup?.defaultDurations ?? { ...DEFAULT_DURATION_DAYS },
        );
        setJql(useStoredSetup ? storedSetup.jql : (boardJql ?? projectJql));
        setValidationErrors([]);
        setSaveStatus("idle");
        issueAbort.current?.abort();
        client.clearIssueCache();
        setIssueLoadState("idle");
        setIssueResult(undefined);
        setIssueLoadedAt(undefined);
      })
      .catch(() => {
        if (isCurrent) {
          setValidationErrors([
            "Power View could not load saved setup from Chrome storage.",
          ]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [client, context.baseUrl, context.boardId, fields, selectedProject, settingsStore]);

  useEffect(
    () => () => {
      requestAbort.current?.abort();
      issueAbort.current?.abort();
    },
    [],
  );

  const invalidateIssuePreview = () => {
    issueAbort.current?.abort();
    client.clearIssueCache();
    setIssueLoadState("idle");
    setIssueProgress(undefined);
    setIssueResult(undefined);
    setIssueLoadedAt(undefined);
    setIssueLoadError(undefined);
  };

  const updateMapping = (key: keyof FieldMapping, value: string) => {
    setFieldMapping((current) => {
      const next = { ...current };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
    setSaveStatus("idle");
    invalidateIssuePreview();
  };

  const updateDuration = (key: keyof DefaultDurationDays, value: string) => {
    const parsed = Number(value);
    setDefaultDurations((current) => ({
      ...current,
      [key]: Number.isFinite(parsed)
        ? Math.min(365, Math.max(1, Math.trunc(parsed)))
        : current[key],
    }));
    setSaveStatus("idle");
  };

  const saveSetup = async (): Promise<boolean> => {
    const errors = [
      ...(selectedProject ? [] : ["Choose a Jira project before saving setup."]),
      ...validateJqlInput(jql),
      ...validateFieldMapping(fieldMapping, fields),
      ...(settingsStore ? [] : ["Chrome settings storage is unavailable."]),
    ];
    setValidationErrors(errors);
    if (errors.length > 0 || !selectedProject || !settingsStore) {
      return false;
    }

    setSaveStatus("saving");
    try {
      await settingsStore.saveSetup({
        jiraBaseUrl: context.baseUrl,
        project: selectedProject,
        ...(context.boardId ? { boardId: context.boardId } : {}),
        jql: jql.trim(),
        fieldMapping,
        defaultDurations,
        updatedAt: new Date().toISOString(),
      });
      setRecentJql(
        await settingsStore.getRecentJql(context.baseUrl, selectedProject.key),
      );
      setSaveStatus("saved");
      return true;
    } catch {
      setValidationErrors(["Power View could not save setup in Chrome storage."]);
      setSaveStatus("idle");
      return false;
    }
  };

  const reportIssueLoad = useCallback(
    (loadedIssueCount: number, cacheStatus: "ready" | "error") => {
      void sendExtensionRequest(
        runtime,
        createIssueLoadReportRequest(loadedIssueCount, cacheStatus),
      ).then(
        (response) => {
          if (response.type === "ERROR") {
            console.warn("Power View could not update issue-load diagnostics.");
          } else {
            onDiagnosticsChanged?.();
          }
        },
        () => {
          console.warn("Power View could not report issue-load diagnostics.");
        },
      );
    },
    [onDiagnosticsChanged, runtime],
  );

  const loadIssues = async (forceRefresh = false) => {
    if (!(await saveSetup())) {
      return;
    }

    issueAbort.current?.abort();
    const controller = new AbortController();
    issueAbort.current = controller;
    setIssueLoadState("loading");
    setIssueProgress({ loaded: 0, page: 0 });
    setIssueResult(undefined);
    setIssueLoadError(undefined);

    try {
      const result = await client.searchIssues(
        {
          jql,
          fieldMapping,
          maxIssues: 1_000,
          pageSize: 100,
          forceRefresh,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setIssueProgress(progress);
            }
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      const loadedAt = new Date().toISOString();
      setIssueResult(result);
      setIssueLoadedAt(loadedAt);
      setIssueLoadState("ready");
      const readySchedule: ReadyGanttSchedule = {
        model: buildGanttScheduleModel(result.values, { defaultDurations }),
        issues: result.values,
        queryKey: scheduleQueryKey,
        jiraBaseUrl: context.baseUrl,
        projectKey: selectedProjectKey,
        projectName: selectedProject?.name ?? selectedProjectKey,
        jql: jql.trim(),
        loadedAt,
        truncated: result.truncated,
        sprintDataAvailable: Boolean(fieldMapping.sprintFieldId),
        storyPointsDataAvailable: Boolean(fieldMapping.storyPointsFieldId),
        editing: {
          client,
          fieldMapping,
          refresh: refreshLoadedIssues,
        },
      };
      onScheduleReady?.(readySchedule);
      onSetupComplete?.(readySchedule);
      reportIssueLoad(result.values.length, "ready");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setIssueLoadState("error");
      setIssueLoadError(
        isJiraClientError(error)
          ? (error.appError.details ?? error.appError.message)
          : "Power View could not load issues for this JQL query.",
      );
      reportIssueLoad(0, "error");
    }
  };

  const refreshLoadedIssues = useCallback(async (): Promise<void> => {
    issueAbort.current?.abort();
    const controller = new AbortController();
    issueAbort.current = controller;
    setIssueLoadState("loading");
    setIssueLoadError(undefined);
    client.clearIssueCache();

    try {
      const result = await client.searchIssues(
        {
          jql,
          fieldMapping,
          maxIssues: 1_000,
          pageSize: 100,
          forceRefresh: true,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setIssueProgress(progress);
            }
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setIssueResult(result);
      setIssueLoadedAt(new Date().toISOString());
      setIssueLoadState("ready");
      reportIssueLoad(result.values.length, "ready");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setIssueLoadState("error");
      setIssueLoadError(
        isJiraClientError(error)
          ? (error.appError.details ?? error.appError.message)
          : "Power View could not refresh issues after the Jira update.",
      );
      reportIssueLoad(0, "error");
      throw error;
    }
  }, [client, fieldMapping, jql, reportIssueLoad]);

  useEffect(() => {
    onScheduleReady?.(
      scheduleModel && issueResult && issueLoadedAt && selectedProject
        ? {
            model: scheduleModel,
            issues: issueResult.values,
            queryKey: scheduleQueryKey,
            jiraBaseUrl: context.baseUrl,
            projectKey: selectedProjectKey,
            projectName: selectedProject.name,
            jql: jql.trim(),
            loadedAt: issueLoadedAt,
            truncated: issueResult.truncated,
            sprintDataAvailable: Boolean(fieldMapping.sprintFieldId),
            storyPointsDataAvailable: Boolean(fieldMapping.storyPointsFieldId),
            editing: {
              client,
              fieldMapping,
              refresh: refreshLoadedIssues,
            },
          }
        : undefined,
    );
  }, [
    client,
    context.baseUrl,
    fieldMapping,
    issueLoadedAt,
    issueResult,
    jql,
    onScheduleReady,
    refreshLoadedIssues,
    scheduleModel,
    scheduleQueryKey,
    selectedProject,
    selectedProjectKey,
  ]);

  return (
    <section id="setup" className="setup-card" aria-labelledby="setup-title">
      <div className="setup-card-header">
        <div>
          <p className="setup-step">MILESTONE 8</p>
          <h2 id="setup-title">Project setup</h2>
        </div>
        <span className={`setup-state setup-state-${loadState}`}>{loadState}</span>
      </div>

      {loadState === "idle" || loadState === "error" ? (
        <div className="setup-intro">
          <p>Load the projects and field metadata available to your current Jira user.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void loadMetadata()}
          >
            {loadState === "error" ? "Retry setup data" : "Load projects and fields"}
          </button>
          {loadError ? <span role="alert">{loadError}</span> : null}
        </div>
      ) : null}

      {loadState === "loading" ? (
        <div className="setup-loading" role="status">
          Loading Jira projects and field metadata…
        </div>
      ) : null}

      {loadState === "ready" ? (
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadIssues();
          }}
        >
          <label>
            <span>Search projects</span>
            <input
              type="search"
              value={projectSearch}
              placeholder="Project name or key"
              onChange={(event) => {
                setProjectSearch(event.target.value);
                setPageStart(0);
              }}
            />
          </label>

          <label>
            <span>Jira project</span>
            <select
              aria-label="Jira project"
              value={selectedProjectKey}
              onChange={(event) => {
                setSelectedProjectKey(event.target.value);
                invalidateIssuePreview();
              }}
            >
              <option value="">Choose a project…</option>
              {projectPage.values.map((project) => (
                <option key={project.id} value={project.key}>
                  {project.key} · {project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="project-pagination" aria-live="polite">
            <span>
              {projectPage.total === 0
                ? "No matching projects"
                : `${projectPage.startAt + 1}–${projectPage.startAt + projectPage.values.length} of ${projectPage.total}`}
            </span>
            <div>
              <button
                type="button"
                disabled={projectPage.startAt === 0}
                onClick={() =>
                  setPageStart(Math.max(0, pageStart - projectPage.maxResults))
                }
              >
                Previous
              </button>
              <button
                type="button"
                disabled={projectPage.isLast}
                onClick={() => setPageStart(pageStart + projectPage.maxResults)}
              >
                Next
              </button>
            </div>
          </div>

          <label>
            <span>JQL query</span>
            <textarea
              value={jql}
              rows={4}
              maxLength={10_000}
              placeholder='project = "POWER" ORDER BY Rank ASC'
              onChange={(event) => {
                setJql(event.target.value);
                setSaveStatus("idle");
                invalidateIssuePreview();
              }}
            />
          </label>

          {recentJql.length > 0 ? (
            <label>
              <span>Recent JQL</span>
              <select
                aria-label="Recent JQL"
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    setJql(event.target.value);
                    setSaveStatus("idle");
                    invalidateIssuePreview();
                  }
                }}
              >
                <option value="">Choose a recent query…</option>
                {recentJql.map((query) => (
                  <option key={query} value={query}>
                    {query}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <fieldset>
            <legend>Date field mapping</legend>
            <p className="field-help">
              Candidates are ranked, but Power View never selects an uncertain custom
              field automatically.
            </p>
            <div className="candidate-row">
              <span>Start suggestions</span>
              <strong>
                {startCandidates
                  .slice(0, 2)
                  .map((candidate) => candidate.name)
                  .join(", ") || "No date candidates"}
              </strong>
            </div>
            <label>
              <span>Start date field</span>
              <select
                aria-label="Start date field"
                value={fieldMapping.startDateFieldId ?? ""}
                onChange={(event) =>
                  updateMapping("startDateFieldId", event.target.value)
                }
              >
                <option value="">Use Jira fallback rules</option>
                {dateFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {fieldOptionLabel(field)}
                  </option>
                ))}
              </select>
            </label>

            <div className="candidate-row">
              <span>End suggestions</span>
              <strong>
                {endCandidates
                  .slice(0, 2)
                  .map((candidate) => candidate.name)
                  .join(", ") || "No date candidates"}
              </strong>
            </div>
            <label>
              <span>End date field</span>
              <select
                aria-label="End date field"
                value={fieldMapping.endDateFieldId ?? ""}
                onChange={(event) => updateMapping("endDateFieldId", event.target.value)}
              >
                <option value="">Use due date and fallback rules</option>
                {dateFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {fieldOptionLabel(field)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <details className="optional-fields">
            <summary>Optional reporting, hierarchy, and story-point fields</summary>
            <p className="field-help">
              Map Sprint to enable planning coverage and the current-sprint report.
              Missing report data is shown as unavailable, never as zero.
            </p>
            <label>
              <span>Sprint field</span>
              <select
                aria-label="Sprint field"
                value={fieldMapping.sprintFieldId ?? ""}
                onChange={(event) => updateMapping("sprintFieldId", event.target.value)}
              >
                <option value="">Not configured</option>
                {allFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {fieldOptionLabel(field)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Hierarchy field</span>
              <select
                aria-label="Hierarchy field"
                value={fieldMapping.hierarchyFieldId ?? ""}
                onChange={(event) =>
                  updateMapping("hierarchyFieldId", event.target.value)
                }
              >
                <option value="">Use Jira parent relationships</option>
                {allFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {fieldOptionLabel(field)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Story points field</span>
              <select
                aria-label="Story points field"
                value={fieldMapping.storyPointsFieldId ?? ""}
                onChange={(event) =>
                  updateMapping("storyPointsFieldId", event.target.value)
                }
              >
                <option value="">Not configured</option>
                {allFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {fieldOptionLabel(field)}
                  </option>
                ))}
              </select>
            </label>
          </details>

          <details className="optional-fields duration-settings">
            <summary>Default durations for inferred end dates</summary>
            <p className="field-help">
              Values are calendar days and are saved with this project setup.
            </p>
            <div className="duration-grid">
              {(
                [
                  ["subtask", "Subtask"],
                  ["task", "Task"],
                  ["bug", "Bug"],
                  ["story", "Story"],
                  ["epic", "Epic"],
                  ["unknown", "Other"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    aria-label={`${label} default duration`}
                    type="number"
                    min="1"
                    max="365"
                    value={defaultDurations[key]}
                    onChange={(event) => updateDuration(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>

          {validationErrors.length > 0 ? (
            <div className="setup-errors" role="alert">
              <strong>Setup needs attention</strong>
              <ul>
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="setup-save-row">
            <button
              className="primary-button"
              type="submit"
              disabled={saveStatus === "saving" || issueLoadState === "loading"}
            >
              {saveStatus === "saving" || issueLoadState === "loading"
                ? "Preparing workspace…"
                : "Save and continue"}
            </button>
            {saveStatus === "saved" ? (
              <span role="status">Setup saved. Preparing your workspace…</span>
            ) : null}
          </div>

          <section className="issue-preview" aria-labelledby="issue-preview-title">
            <div className="issue-preview-heading">
              <div>
                <span>READ-ONLY SEARCH</span>
                <h3 id="issue-preview-title">Issue preview</h3>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={issueLoadState === "loading"}
                onClick={() => void loadIssues()}
              >
                {issueLoadState === "loading" ? "Loading issues…" : "Preview issues"}
              </button>
            </div>

            {issueLoadState === "idle" ? (
              <p>Validate and normalize up to 1,000 issues before opening a view.</p>
            ) : null}

            {issueLoadState === "loading" && issueProgress ? (
              <div className="issue-progress" role="status">
                <strong>{issueProgress.loaded} issues normalized</strong>
                <span>
                  Page {issueProgress.page}
                  {issueProgress.total === undefined
                    ? ""
                    : ` · ${issueProgress.total} visible in Jira`}
                </span>
              </div>
            ) : null}

            {issueLoadState === "error" ? (
              <div className="issue-preview-error" role="alert">
                <strong>Issue loading failed</strong>
                <span>{issueLoadError}</span>
              </div>
            ) : null}

            {issueLoadState === "ready" && issueResult ? (
              <div className="issue-preview-result" role="status">
                <div>
                  <strong>{issueResult.values.length} normalized issues ready</strong>
                  <span>
                    {issueResult.fromCache
                      ? "Loaded from 5-minute cache"
                      : "Loaded from Jira"}
                    {issueResult.truncated ? " · stopped at the 1,000 issue limit" : ""}
                  </span>
                  <button
                    className="issue-refresh-button"
                    type="button"
                    onClick={() => void loadIssues(true)}
                  >
                    Refresh from Jira
                  </button>
                </div>
                {issueResult.values.length > 0 ? (
                  <ul aria-label="Issue preview sample">
                    {issueResult.values.slice(0, 5).map((issue) => (
                      <li key={issue.id}>
                        <a href={issue.browseUrl} target="_blank" rel="noreferrer">
                          {issue.key}
                        </a>
                        <span>{issue.summary}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No accessible issues matched this query.</p>
                )}
                {scheduleModel ? (
                  <div className="schedule-summary">
                    <strong>
                      {scheduleModel.tasks.length} deterministic Gantt tasks
                    </strong>
                    <span>
                      {scheduleModel.roots.length} roots ·{" "}
                      {scheduleModel.syntheticDateCount} inferred date ranges ·{" "}
                      {scheduleModel.dependencyCount} dependencies ·{" "}
                      {scheduleModel.warnings.length} warnings
                    </span>
                    {scheduleModel.tasks.length > 0 ? (
                      <ul aria-label="Schedule preview sample">
                        {scheduleModel.tasks.slice(0, 5).map((task) => (
                          <li key={task.id}>
                            <strong>
                              {"↳ ".repeat(task.depth)}
                              {task.issueKey}
                            </strong>
                            <span>
                              {task.start} → {task.end} · {task.progress}%
                            </span>
                            {task.dateWarning ? (
                              <span
                                className="date-warning-icon"
                                title={task.dateWarning}
                                aria-label={`${task.issueKey}: ${task.dateWarning}`}
                              >
                                !
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </form>
      ) : null}
    </section>
  );
}
