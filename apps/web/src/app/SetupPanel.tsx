import {
  buildGanttScheduleModel,
  buildDefaultBoardJql,
  buildDefaultProjectJql,
  DEFAULT_DURATION_DAYS,
  MAX_CONFIGURABLE_ISSUES,
  rankDateFieldCandidates,
  validateFieldMapping,
  validateJqlInput,
  type FieldMapping,
  type DefaultDurationDays,
  type GanttScheduleModel,
  type IssueSearchResult,
  type JiraBoard,
  type JiraField,
  type NormalizedIssue,
  type JiraPageContext,
  type JiraProject,
  type PaginatedResult,
  type PageProgress,
  type SetupConfiguration,
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

import { loadProjectBoards } from "./load-project-boards";

export interface SetupPanelProps {
  context: JiraPageContext;
  runtime: ExtensionRuntime;
  settingsStore?: SettingsStore;
  onDiagnosticsChanged?: () => void;
  onScheduleReady?: (schedule: ReadyGanttSchedule | undefined) => void;
  onSetupComplete?: (schedule: ReadyGanttSchedule) => void;
  /** Skip straight past this page when a matching saved setup already exists.
   * Only appropriate on the very first arrival at Settings in a session — pass
   * false when the user explicitly navigated here to review/edit an existing
   * setup, otherwise they'd get bounced straight back to where they came from. */
  autoContinue?: boolean;
}

export interface ReadyGanttSchedule {
  model: GanttScheduleModel;
  issues: NormalizedIssue[];
  queryKey: string;
  jiraBaseUrl: string;
  projectKey: string;
  projectName: string;
  board: JiraBoard;
  reporting: {
    completedStatusIds: string[];
    completedStatusNames: string[];
  };
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

interface StatusOption {
  id: string;
  name: string;
}

async function loadBoardStatuses(
  client: JiraClient,
  boardId: string,
  signal: AbortSignal,
): Promise<StatusOption[]> {
  const statuses = new Map<string, StatusOption>();
  const page = await client.getBoardIssues(
    // Only issue.status is read below, so skip the standard field payload.
    { boardId, pageSize: 100, fieldsOverride: ["status"] },
    signal,
  );
  page.values.forEach((issue) => {
    const id = issue.status.id ?? issue.status.name;
    statuses.set(id, { id, name: issue.status.name });
  });

  return [...statuses.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function boardStatusOptions(
  boardStatusIds: string[],
  projectStatuses: StatusOption[],
  issueStatuses: StatusOption[],
): StatusOption[] {
  const knownStatuses = new Map(
    [...projectStatuses, ...issueStatuses].map((status) => [status.id, status]),
  );
  const statuses =
    boardStatusIds.length > 0
      ? boardStatusIds.map(
          (statusId) =>
            knownStatuses.get(statusId) ?? {
              id: statusId,
              name: `Status ${statusId}`,
            },
        )
      : issueStatuses;
  return [...new Map(statuses.map((status) => [status.id, status])).values()].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
}

function resolveCompletedStatuses(
  completedStatusIds: string[],
  statusOptions: StatusOption[],
): { completedStatusIds: string[]; completedStatusNames: string[] } {
  const statusById = new Map(statusOptions.map((status) => [status.id, status]));
  const resolved = completedStatusIds.flatMap((id) => {
    const status = statusById.get(id);
    return status ? [status] : [];
  });
  return {
    completedStatusIds: resolved.map((status) => status.id),
    completedStatusNames: resolved.map((status) => status.name),
  };
}

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
  autoContinue = true,
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
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [boardLoadState, setBoardLoadState] = useState<LoadState>("idle");
  const [boardLoadError, setBoardLoadError] = useState<string>();
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [statusResolutionWarning, setStatusResolutionWarning] = useState<string>();
  const [completedStatusIds, setCompletedStatusIds] = useState<string[]>([]);
  const [storedSetup, setStoredSetup] = useState<SetupConfiguration>();
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
  const selectedBoard = boards.find((board) => board.id === selectedBoardId);
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

  const loadMetadata = useCallback(async () => {
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
  }, [applyProjectPage, client, context.projectKey, projectSearch]);

  const hasAutoLoadedMetadata = useRef(false);
  useEffect(() => {
    if (hasAutoLoadedMetadata.current) return;
    hasAutoLoadedMetadata.current = true;
    void loadMetadata();
  }, [loadMetadata]);

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

  const invalidateIssuePreview = useCallback(() => {
    issueAbort.current?.abort();
    client.clearIssueCache();
    setIssueLoadState("idle");
    setIssueProgress(undefined);
    setIssueResult(undefined);
    setIssueLoadedAt(undefined);
    setIssueLoadError(undefined);
  }, [client]);

  useEffect(() => {
    if (!selectedProjectKey) {
      setBoards([]);
      setSelectedBoardId("");
      setStatusOptions([]);
      setCompletedStatusIds([]);
      setStoredSetup(undefined);
      return;
    }

    if (!settingsStore) {
      setRecentJql([]);
      setFieldMapping({});
      setDefaultDurations({ ...DEFAULT_DURATION_DAYS });
      setJql(buildDefaultProjectJql(selectedProjectKey));
      setBoards([]);
      setSelectedBoardId("");
      setValidationErrors([]);
      setSaveStatus("idle");
      issueAbort.current?.abort();
      client.clearIssueCache();
      setIssueLoadState("idle");
      setIssueResult(undefined);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    setBoardLoadState("loading");
    setBoardLoadError(undefined);
    void Promise.all([
      settingsStore.getSetup(context.baseUrl, selectedProjectKey),
      settingsStore.getRecentJql(context.baseUrl, selectedProjectKey),
      loadProjectBoards(client, selectedProjectKey, context.boardId, controller.signal),
    ])
      .then(([loadedSetup, storedRecentJql, loadedBoards]) => {
        if (!isCurrent) {
          return;
        }
        setStoredSetup(loadedSetup);
        setBoards(loadedBoards);
        const preferredBoard =
          loadedBoards.find((board) => board.id === loadedSetup?.board?.id) ??
          loadedBoards.find((board) => board.id === context.boardId) ??
          (loadedBoards.length === 1 ? loadedBoards[0] : undefined);
        setSelectedBoardId(preferredBoard?.id ?? "");
        setRecentJql(storedRecentJql);
        setFieldMapping({
          ...inferredReportFieldMapping(fields),
          ...(loadedSetup?.fieldMapping ?? {}),
        });
        setDefaultDurations(
          loadedSetup?.defaultDurations ?? { ...DEFAULT_DURATION_DAYS },
        );
        setJql(loadedSetup?.jql ?? buildDefaultProjectJql(selectedProjectKey));
        setBoardLoadState("ready");
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
          setBoardLoadState("error");
          setBoardLoadError("Power View could not load boards for this project.");
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [
    client,
    context.baseUrl,
    context.boardId,
    fields,
    selectedProjectKey,
    settingsStore,
  ]);

  useEffect(() => {
    if (!selectedBoard || !selectedProjectKey) {
      setStatusOptions([]);
      setCompletedStatusIds([]);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    setBoardLoadState("loading");
    setBoardLoadError(undefined);
    setStatusResolutionWarning(undefined);
    const boardProjectKeys = new Set([
      selectedProjectKey,
      ...(selectedBoard.projectKeys ?? []),
    ]);
    void Promise.all([
      client.getBoardConfiguration(selectedBoard.id, controller.signal),
      Promise.all(
        [...boardProjectKeys].map((projectKey) =>
          client.getProjectStatuses(projectKey, controller.signal).catch(() => []),
        ),
      ).then((results) => results.flat()),
    ])
      .then(([boardConfiguration, projectStatuses]) => {
        if (!isCurrent) return;
        const statuses = boardStatusOptions(
          boardConfiguration.statusIds,
          projectStatuses,
          [],
        );
        const storedForBoard = storedSetup?.board?.id === selectedBoard.id;
        const completedIds = storedForBoard
          ? (storedSetup.reporting?.completedStatusIds ?? [])
          : statuses
              .filter((status) =>
                ["done", "in review"].includes(status.name.trim().toLowerCase()),
              )
              .map((status) => status.id);
        setStatusOptions(statuses);
        setCompletedStatusIds(completedIds);
        if (!storedForBoard) {
          setJql(
            boardConfiguration.filterId
              ? buildDefaultBoardJql(boardConfiguration.filterId)
              : buildDefaultProjectJql(selectedProjectKey),
          );
        }
        setBoardLoadState("ready");
        invalidateIssuePreview();
        const hasInitialPlaceholder = statuses.some(
          (status) => status.name === `Status ${status.id}`,
        );
        void loadBoardStatuses(client, selectedBoard.id, controller.signal)
          .then(async (issueStatuses) => {
            if (!isCurrent) return;
            let combined = issueStatuses.length > 0 ? issueStatuses : [];
            let resolved = boardStatusOptions(
              boardConfiguration.statusIds,
              projectStatuses,
              combined,
            );
            // Statuses configured on the board but not covered by the
            // project's status catalog or the sampled issues (e.g. a
            // workflow status with no current issues) still show as
            // placeholders here — fetch the full instance catalog only as a
            // last resort to resolve just those remaining names.
            if (resolved.some((status) => status.name === `Status ${status.id}`)) {
              let allStatuses: StatusOption[] = [];
              let catalogFetchFailed = false;
              try {
                allStatuses = await client.getStatuses(controller.signal);
              } catch {
                catalogFetchFailed = true;
              }
              if (!isCurrent) return;
              combined = [...combined, ...allStatuses];
              resolved = boardStatusOptions(
                boardConfiguration.statusIds,
                projectStatuses,
                combined,
              );
              if (resolved.some((status) => status.name === `Status ${status.id}`)) {
                setStatusResolutionWarning(
                  catalogFetchFailed
                    ? "Some board statuses could not be resolved from Jira; they're shown by ID. Reopen this board to try again."
                    : "Some board statuses aren't in Jira's current status catalog (they may have been deleted or renamed); they're shown by ID.",
                );
              }
            }
            setStatusOptions(resolved);
          })
          .catch(() => {
            // The refinement pass (sampling board issues and, if needed, the
            // full status catalog) failed outright — statusOptions is still
            // whatever boardStatusOptions produced synchronously above, so
            // any placeholder left in it will otherwise show with zero
            // explanation. Say so rather than going silent.
            if (!isCurrent || !hasInitialPlaceholder) return;
            setStatusResolutionWarning(
              "Some board statuses could not be resolved from Jira; they're shown by ID. Reopen this board to try again.",
            );
          });
      })
      .catch(() => {
        if (!isCurrent) return;
        setBoardLoadState("error");
        setBoardLoadError("Power View could not load the selected board configuration.");
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [client, invalidateIssuePreview, selectedBoard, selectedProjectKey, storedSetup]);

  useEffect(
    () => () => {
      requestAbort.current?.abort();
      issueAbort.current?.abort();
    },
    [],
  );

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
      ...(selectedBoard ? [] : ["Choose a Jira board before saving setup."]),
      ...(completedStatusIds.length > 0
        ? []
        : ["Choose at least one completed Jira status."]),
      ...validateJqlInput(jql),
      ...validateFieldMapping(fieldMapping, fields),
      ...(settingsStore ? [] : ["Chrome settings storage is unavailable."]),
    ];
    setValidationErrors(errors);
    if (errors.length > 0 || !selectedProject || !selectedBoard || !settingsStore) {
      return false;
    }

    setSaveStatus("saving");
    try {
      const reporting = resolveCompletedStatuses(completedStatusIds, statusOptions);
      await settingsStore.saveSetup({
        jiraBaseUrl: context.baseUrl,
        project: selectedProject,
        board: selectedBoard,
        jql: jql.trim(),
        fieldMapping,
        reporting,
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
          maxIssues: MAX_CONFIGURABLE_ISSUES,
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
        board: selectedBoard!,
        reporting: resolveCompletedStatuses(completedStatusIds, statusOptions),
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

  // If this board already has a complete saved setup (returning to a board you've
  // configured before, not the first time through), skip straight to loading issues
  // instead of making the user resubmit a form that's already correctly filled in.
  const loadIssuesRef = useRef(loadIssues);
  loadIssuesRef.current = loadIssues;
  const hasAutoSubmitted = useRef(false);
  useEffect(() => {
    if (!autoContinue || hasAutoSubmitted.current) return;
    if (
      boardLoadState === "ready" &&
      selectedBoard &&
      storedSetup?.board?.id === selectedBoard.id &&
      jql.trim().length > 0 &&
      completedStatusIds.length > 0
    ) {
      hasAutoSubmitted.current = true;
      void loadIssuesRef.current();
    }
  }, [autoContinue, boardLoadState, selectedBoard, storedSetup, jql, completedStatusIds]);

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
          maxIssues: MAX_CONFIGURABLE_ISSUES,
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
      scheduleModel && issueResult && issueLoadedAt && selectedProject && selectedBoard
        ? {
            model: scheduleModel,
            issues: issueResult.values,
            queryKey: scheduleQueryKey,
            jiraBaseUrl: context.baseUrl,
            projectKey: selectedProjectKey,
            projectName: selectedProject.name,
            board: selectedBoard,
            reporting: resolveCompletedStatuses(completedStatusIds, statusOptions),
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
    selectedBoard,
    completedStatusIds,
    statusOptions,
  ]);

  // A returning board with a matching saved setup is auto-continued straight to the
  // chooser (see the effect above) — keep showing a preloader instead of the form
  // itself while that's still being decided, so the form never flashes on screen
  // only to immediately navigate away. If auto-continuing fails, fall through to
  // showing the form (with the error) once loadIssues settles on "error".
  const isReturningBoard =
    autoContinue &&
    boardLoadState === "ready" &&
    Boolean(selectedBoard) &&
    storedSetup?.board?.id === selectedBoard?.id;
  const resolving =
    loadState !== "error" &&
    boardLoadState !== "error" &&
    (loadState !== "ready" ||
      boardLoadState !== "ready" ||
      (isReturningBoard && issueLoadState !== "error"));

  // Only hide the form behind the preloader while we're still deciding whether to
  // auto-continue. Once the form has been shown once, later loading blips from the
  // user changing project/board manually shouldn't hide the whole form again.
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);
  useEffect(() => {
    if (!resolving) setHasResolvedOnce(true);
  }, [resolving]);

  if (resolving && !hasResolvedOnce) {
    return (
      <div id="setup" className="setup-loading" role="status">
        <span className="reporting-spinner" aria-hidden="true" />
        Preparing your workspace…
      </div>
    );
  }

  return (
    <div id="setup">
      {loadState === "error" ? (
        <div className="setup-intro">
          <p role="alert">{loadError ?? "Power View could not load Jira setup data."}</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void loadMetadata()}
          >
            Retry setup data
          </button>
        </div>
      ) : null}

      {loadState === "idle" || loadState === "loading" ? (
        <div className="setup-loading" role="status">
          <span className="reporting-spinner" aria-hidden="true" />
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
          <div className="setup-project-board">
            <label className="setup-search-field">
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

            <label className="setup-project-field">
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

            <label className="setup-board-column">
              <span>Jira board</span>
              <select
                aria-label="Jira board"
                value={selectedBoardId}
                disabled={!selectedProject || boardLoadState === "loading"}
                onChange={(event) => {
                  setSelectedBoardId(event.target.value);
                  setSaveStatus("idle");
                  invalidateIssuePreview();
                }}
              >
                <option value="">Choose a board…</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name} · {board.type}
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
          </div>

          {boardLoadError ? (
            <div className="setup-errors" role="alert">
              {boardLoadError}
            </div>
          ) : null}

          <details className="optional-fields">
            <summary>Advanced: query, completed statuses, and date fields</summary>

            <div className="accordion-body">
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
              <legend>Completed statuses</legend>
              <p className="field-help">
                This board-level mapping is inherited by Board Health and every report.
              </p>
              {statusResolutionWarning ? (
                <p className="field-warning" role="status">
                  {statusResolutionWarning}
                </p>
              ) : null}
              <div className="reporting-status-list">
                {statusOptions.map((status) => (
                  <label key={status.id}>
                    <input
                      type="checkbox"
                      checked={completedStatusIds.includes(status.id)}
                      onChange={() => {
                        setCompletedStatusIds((current) =>
                          current.includes(status.id)
                            ? current.filter((id) => id !== status.id)
                            : [...current, status.id],
                        );
                        setSaveStatus("idle");
                      }}
                    />
                    <span>{status.name}</span>
                  </label>
                ))}
                {selectedBoard &&
                boardLoadState === "ready" &&
                statusOptions.length === 0 ? (
                  <span>No statuses were returned for this board.</span>
                ) : null}
              </div>
            </fieldset>

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
                  onChange={(event) =>
                    updateMapping("endDateFieldId", event.target.value)
                  }
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
            </div>
          </details>

          <details className="optional-fields">
            <summary>Optional reporting, hierarchy, and story-point fields</summary>
            <div className="accordion-body">
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
            </div>
          </details>

          <details className="optional-fields duration-settings">
            <summary>Default durations for inferred end dates</summary>
            <div className="accordion-body">
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
              <p>
                Validate and normalize up to {MAX_CONFIGURABLE_ISSUES.toLocaleString()}{" "}
                issues before opening a view.
              </p>
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
                    {issueResult.truncated
                      ? ` · stopped at the ${MAX_CONFIGURABLE_ISSUES.toLocaleString()} issue limit`
                      : ""}
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
    </div>
  );
}
