import {
  classifyIssueLinkRelationship,
  type FieldMapping,
  type GanttTask,
  type JiraUser,
} from "@power-view/domain";
import {
  isJiraClientError,
  type JiraClient,
  type JiraIssueEditField,
  type JiraIssueEditMetadata,
  type JiraIssueLinkType,
} from "@power-view/jira-client";
import { useEffect, useMemo, useState } from "react";

export interface GanttEditingContext {
  client: JiraClient;
  fieldMapping: FieldMapping;
  refresh: () => Promise<void>;
}

export interface GanttEditPanelProps {
  task: GanttTask;
  tasks: GanttTask[];
  editing: GanttEditingContext;
}

function userIdentifier(user: JiraUser): string {
  return user.accountId ?? user.username ?? user.displayName;
}

function editableField(field: JiraIssueEditField | undefined): boolean {
  return Boolean(
    field && (field.operations.length === 0 || field.operations.includes("set")),
  );
}

function jiraDateValue(value: string, field: JiraIssueEditField | undefined) {
  if (!value) {
    return null;
  }
  if (field?.schema?.type?.toLowerCase() !== "datetime") {
    return value;
  }

  const [year, month, day] = value.split("-").map(Number);
  const localNoon = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
  const offsetMinutes = -localNoon.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${value}T12:00:00.000${sign}${hours}${minutes}`;
}

function mutationErrorMessage(error: unknown): string {
  return isJiraClientError(error)
    ? (error.appError.details ?? error.appError.message)
    : "Jira could not apply this change. Reload the issue and retry.";
}

function isMissingJiraContext(error: unknown): boolean {
  return isJiraClientError(error) && error.appError.code === "JIRA_NOT_DETECTED";
}

function dependencyIssueOrder(
  type: JiraIssueLinkType,
  dependentIssueKey: string,
  prerequisiteIssueKey: string,
): { inwardIssueKey: string; outwardIssueKey: string } {
  const outward = `${type.name} ${type.outward}`.toLowerCase();
  const outwardMeansDependency =
    outward.includes("depends on") || outward.includes("blocked by");
  return outwardMeansDependency
    ? {
        inwardIssueKey: dependentIssueKey,
        outwardIssueKey: prerequisiteIssueKey,
      }
    : {
        inwardIssueKey: prerequisiteIssueKey,
        outwardIssueKey: dependentIssueKey,
      };
}

function isDependencyLinkType(type: JiraIssueLinkType): boolean {
  const kind = classifyIssueLinkRelationship(type.name, type.inward, type.outward);
  return kind === "blocks" || kind === "finish-to-finish" || kind === "depends";
}

function canLinkAsDependency(a: GanttTask, b: GanttTask): boolean {
  const typeOf = (task: GanttTask) => task.issueTypeName.trim().toLowerCase();
  const isEpic = (task: GanttTask) => typeOf(task) === "epic";
  const isStory = (task: GanttTask) => typeOf(task) === "story";
  const isTaskOrBug = (task: GanttTask) =>
    typeOf(task) === "task" || typeOf(task) === "bug";

  if (isEpic(a) && isEpic(b)) {
    return true;
  }
  if (isStory(a) && isStory(b)) {
    return a.parentId !== undefined && a.parentId === b.parentId;
  }
  if (isTaskOrBug(a) && isTaskOrBug(b)) {
    return a.parentId !== undefined && a.parentId === b.parentId;
  }
  return false;
}

export function GanttEditPanel({ task, tasks, editing }: GanttEditPanelProps) {
  const [metadata, setMetadata] = useState<JiraIssueEditMetadata>();
  const [metadataError, setMetadataError] = useState<string>();
  const [contextMissing, setContextMissing] = useState(false);
  const [linkTypes, setLinkTypes] = useState<JiraIssueLinkType[]>([]);
  const [linkTypesError, setLinkTypesError] = useState<string>();
  const [startDate, setStartDate] = useState(task.start);
  const [dueDate, setDueDate] = useState(task.end);
  const [startDirty, setStartDirty] = useState(false);
  const [dueDirty, setDueDirty] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignees, setAssignees] = useState<JiraUser[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [dependencyTaskId, setDependencyTaskId] = useState("");
  const [linkTypeName, setLinkTypeName] = useState("");
  const [busyAction, setBusyAction] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);

  const startFieldId = editing.fieldMapping.startDateFieldId ?? "startdate";
  const dueFieldId = editing.fieldMapping.endDateFieldId ?? "duedate";
  const startField = metadata?.fields[startFieldId];
  const dueField = metadata?.fields[dueFieldId];
  const assigneeField = metadata?.fields.assignee;

  useEffect(() => {
    const controller = new AbortController();
    setMetadata(undefined);
    setMetadataError(undefined);
    setContextMissing(false);
    setLinkTypes([]);
    setLinkTypesError(undefined);
    setAssigneeQuery("");
    setAssignees([]);
    setSelectedAssignee("");
    setDependencyTaskId("");
    setLinkTypeName("");

    void editing.client
      .getIssueEditMetadata(task.issueKey, controller.signal)
      .then(setMetadata, (loadError: unknown) => {
        if (!controller.signal.aborted) {
          setMetadataError(mutationErrorMessage(loadError));
          setContextMissing(isMissingJiraContext(loadError));
        }
      });
    void editing.client.getIssueLinkTypes(controller.signal).then(
      (types) => {
        if (controller.signal.aborted) {
          return;
        }
        const dependencyTypes = types.filter(isDependencyLinkType);
        setLinkTypes(dependencyTypes);
        const preferred =
          dependencyTypes.find((type) => type.name.toLowerCase() === "blocks") ??
          dependencyTypes[0];
        setLinkTypeName(preferred?.name ?? "");
        if (dependencyTypes.length === 0) {
          setLinkTypesError("Jira did not return a Blocks or Depends issue-link type.");
        }
      },
      (loadError: unknown) => {
        if (!controller.signal.aborted) {
          setLinkTypesError(mutationErrorMessage(loadError));
        }
      },
    );

    return () => controller.abort();
  }, [editing.client, reloadToken, task.issueKey]);

  useEffect(() => {
    setStartDate(task.start);
    setDueDate(task.end);
    setStartDirty(false);
    setDueDirty(false);
  }, [task.end, task.start]);

  useEffect(() => {
    setStatus(undefined);
    setError(undefined);
  }, [task.issueKey]);

  const dependencyCandidates = useMemo(() => {
    const existing = new Set(task.dependencies);
    return tasks
      .filter((candidate) => candidate.id !== task.id && !existing.has(candidate.id))
      .filter((candidate) => canLinkAsDependency(task, candidate))
      .sort((left, right) => left.issueKey.localeCompare(right.issueKey));
  }, [task, tasks]);

  const runMutation = async (
    action: string,
    confirmation: string,
    mutation: () => Promise<void>,
  ): Promise<void> => {
    if (!window.confirm(confirmation)) {
      return;
    }
    setBusyAction(action);
    setStatus(undefined);
    setError(undefined);
    try {
      await mutation();
      await editing.refresh();
      setStatus(`${action} saved in Jira.`);
    } catch (mutationError) {
      setError(mutationErrorMessage(mutationError));
    } finally {
      setBusyAction(undefined);
    }
  };

  const saveDates = async () => {
    if (!startDirty && !dueDirty) {
      setError("Change at least one date before saving.");
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError("Start date cannot be after due date.");
      return;
    }
    if ((startField?.required && !startDate) || (dueField?.required && !dueDate)) {
      setError("A required Jira date field cannot be cleared.");
      return;
    }

    await runMutation("Dates", `Update dates for ${task.issueKey} in Jira?`, () =>
      editing.client.updateIssueDates(task.issueKey, {
        fieldMapping: editing.fieldMapping,
        ...(startDirty ? { startDate: jiraDateValue(startDate, startField) } : {}),
        ...(dueDirty ? { dueDate: jiraDateValue(dueDate, dueField) } : {}),
      }),
    );
  };

  const searchAssignees = async () => {
    setBusyAction("Assignee search");
    setError(undefined);
    try {
      const users = await editing.client.findAssignableUsers(
        task.issueKey,
        assigneeQuery.trim(),
      );
      setAssignees(users);
      setSelectedAssignee((current) =>
        users.some((user) => userIdentifier(user) === current)
          ? current
          : users[0]
            ? userIdentifier(users[0])
            : "",
      );
      if (users.length === 0) {
        setStatus("No assignable Jira users matched this search.");
      }
    } catch (searchError) {
      setError(mutationErrorMessage(searchError));
    } finally {
      setBusyAction(undefined);
    }
  };

  const saveAssignee = async () => {
    const user = assignees.find(
      (candidate) => userIdentifier(candidate) === selectedAssignee,
    );
    if (!user) {
      setError("Search for and select an assignable Jira user first.");
      return;
    }
    await runMutation("Assignee", `Assign ${task.issueKey} to ${user.displayName}?`, () =>
      editing.client.assignIssue(task.issueKey, user),
    );
  };

  const unassign = () =>
    runMutation("Assignee", `Remove the assignee from ${task.issueKey}?`, () =>
      editing.client.assignIssue(task.issueKey, null),
    );

  const addDependency = async () => {
    const prerequisite = tasks.find((candidate) => candidate.id === dependencyTaskId);
    const linkType = linkTypes.find((type) => type.name === linkTypeName);
    if (!prerequisite || !linkType) {
      setError("Choose both a prerequisite issue and a Jira link type.");
      return;
    }
    const issueOrder = dependencyIssueOrder(
      linkType,
      task.issueKey,
      prerequisite.issueKey,
    );
    await runMutation(
      "Dependency",
      `Make ${task.issueKey} depend on ${prerequisite.issueKey} using “${linkType.name}”?`,
      () =>
        editing.client.createIssueLink({
          typeName: linkType.name,
          ...issueOrder,
        }),
    );
  };

  const removeDependency = (linkId: string, issueKey: string) =>
    runMutation(
      "Dependency",
      `Remove the dependency between ${task.issueKey} and ${issueKey}?`,
      () => editing.client.deleteIssueLink(linkId),
    );

  const metadataLoading = !metadata && !metadataError;
  const isBusy = busyAction !== undefined;

  return (
    <section className="gantt-edit-panel" aria-labelledby="gantt-edit-title">
      <div className="gantt-edit-heading">
        <div>
          <p className="setup-step">EDIT MODE</p>
          <h4 id="gantt-edit-title">Update {task.issueKey} in Jira</h4>
        </div>
        <span className="edit-session-badge">BROWSER SESSION</span>
      </div>
      <p className="gantt-edit-note">
        Every write is confirmed before it is sent. Jira permissions and field
        configuration remain authoritative.
      </p>

      {metadataLoading ? <p role="status">Checking editable Jira fields…</p> : null}
      {metadataError ? (
        <div className="gantt-edit-error" role="alert">
          <strong>Editable fields unavailable</strong>
          <p>{metadataError}</p>
          {contextMissing ? (
            <p>
              Keep the Jira issue or project tab open, choose <b>Detect again</b> in the
              extension popup, then retry here.
            </p>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={() => setReloadToken((current) => current + 1)}
          >
            Retry editable fields
          </button>
        </div>
      ) : null}

      <fieldset className="gantt-edit-group" disabled={isBusy || metadataLoading}>
        <legend>Schedule dates</legend>
        <div className="gantt-edit-row">
          <label>
            {startField?.name ?? "Start date"}
            <input
              type="date"
              value={startDate}
              disabled={!editableField(startField)}
              onChange={(event) => {
                setStartDate(event.target.value);
                setStartDirty(true);
              }}
            />
          </label>
          <label>
            {dueField?.name ?? "Due date"}
            <input
              type="date"
              value={dueDate}
              disabled={!editableField(dueField)}
              onChange={(event) => {
                setDueDate(event.target.value);
                setDueDirty(true);
              }}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={
              (!startDirty && !dueDirty) ||
              (!editableField(startField) && !editableField(dueField))
            }
            onClick={() => void saveDates()}
          >
            {busyAction === "Dates" ? "Saving…" : "Save dates"}
          </button>
        </div>
        {metadata && (!editableField(startField) || !editableField(dueField)) ? (
          <small>
            A disabled date is not present in Jira edit metadata for this issue.
          </small>
        ) : null}
      </fieldset>

      <fieldset className="gantt-edit-group" disabled={isBusy || metadataLoading}>
        <legend>Assignee</legend>
        <div className="gantt-edit-row">
          <label className="gantt-edit-grow">
            Search assignable users
            <input
              type="search"
              value={assigneeQuery}
              disabled={!editableField(assigneeField)}
              placeholder="Name or email"
              onChange={(event) => setAssigneeQuery(event.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={!editableField(assigneeField)}
            onClick={() => void searchAssignees()}
          >
            {busyAction === "Assignee search" ? "Searching…" : "Search"}
          </button>
        </div>
        {assignees.length > 0 ? (
          <div className="gantt-edit-row">
            <label className="gantt-edit-grow">
              Assign to
              <select
                value={selectedAssignee}
                onChange={(event) => setSelectedAssignee(event.target.value)}
              >
                {assignees.map((user) => (
                  <option key={userIdentifier(user)} value={userIdentifier(user)}>
                    {user.displayName}
                    {user.emailAddress ? ` · ${user.emailAddress}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void saveAssignee()}
            >
              Save assignee
            </button>
          </div>
        ) : null}
        <button
          className="text-button gantt-unassign-button"
          type="button"
          disabled={!editableField(assigneeField) || assigneeField?.required}
          onClick={() => void unassign()}
        >
          Set unassigned
        </button>
      </fieldset>

      <fieldset className="gantt-edit-group" disabled={isBusy}>
        <legend>Dependencies</legend>
        {(task.dependencyLinks ?? []).length > 0 ? (
          <ul className="gantt-edit-dependencies">
            {(task.dependencyLinks ?? []).map((dependency) => (
              <li
                key={`${dependency.taskId}-${dependency.linkId ?? dependency.typeName}`}
              >
                <span>
                  {dependency.issueKey} · {dependency.typeName}
                </span>
                <button
                  className="text-button"
                  type="button"
                  disabled={!dependency.linkId}
                  title={
                    dependency.linkId
                      ? "Delete this Jira issue link"
                      : "Jira did not return a link identifier"
                  }
                  onClick={() =>
                    dependency.linkId
                      ? void removeDependency(dependency.linkId, dependency.issueKey)
                      : undefined
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <small>No loaded prerequisite links.</small>
        )}
        <p className="gantt-edit-note">
          You can only link Epics to Epics, Stories within the same Epic, or Tasks/Bugs
          within the same Story.
        </p>
        <div className="gantt-edit-row">
          <label className="gantt-edit-grow">
            Depends on
            <select
              value={dependencyTaskId}
              onChange={(event) => setDependencyTaskId(event.target.value)}
            >
              <option value="">Choose an issue</option>
              {dependencyCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.issueKey} · {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Jira link type
            <select
              value={linkTypeName}
              disabled={linkTypes.length === 0}
              onChange={(event) => setLinkTypeName(event.target.value)}
            >
              {linkTypes.map((type) => (
                <option key={type.id} value={type.name}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={!dependencyTaskId || !linkTypeName}
            onClick={() => void addDependency()}
          >
            Add dependency
          </button>
        </div>
        {linkTypesError ? (
          <small className="gantt-edit-error">{linkTypesError}</small>
        ) : null}
      </fieldset>

      {status ? (
        <p className="gantt-edit-success" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="gantt-edit-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
