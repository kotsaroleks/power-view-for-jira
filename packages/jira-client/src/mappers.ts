import {
  classifyIssueLinkRelationship,
  type FieldMapping,
  type JiraDeploymentType,
  type JiraField,
  type JiraProject,
  type JiraServerInfo,
  type JiraIssueSprint,
  type JiraSprintState,
  type JiraStatusCategory,
  type JiraUser,
  type NormalizedHierarchyReference,
  type NormalizedIssue,
  type NormalizedIssueLink,
} from "@power-view/domain";

import type {
  RawJiraField,
  RawJiraIssue,
  RawJiraProject,
  RawJiraServerInfo,
  RawJiraUser,
} from "./schemas";

export function mapJiraUser(rawUser: RawJiraUser): JiraUser {
  const username = rawUser.name ?? rawUser.key;
  const avatarUrl = rawUser.avatarUrls?.["48x48"] ?? rawUser.avatarUrls?.["32x32"];

  return {
    displayName: rawUser.displayName,
    ...(rawUser.accountId ? { accountId: rawUser.accountId } : {}),
    ...(username ? { username } : {}),
    ...(rawUser.emailAddress ? { emailAddress: rawUser.emailAddress } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function declaredDeploymentType(value?: string): JiraDeploymentType | undefined {
  switch (value?.toLowerCase()) {
    case "cloud":
      return "cloud";
    case "data-center":
    case "data center":
    case "datacenter":
      return "data-center";
    case "server":
      return "server";
    default:
      return undefined;
  }
}

function resolveDeploymentType(
  baseUrl: string,
  hint: JiraDeploymentType,
  declaredType?: string,
): JiraDeploymentType {
  const declared = declaredDeploymentType(declaredType);
  if (declared) {
    return declared;
  }
  if (new URL(baseUrl).hostname.toLowerCase().endsWith(".atlassian.net")) {
    return "cloud";
  }
  return hint;
}

export function mapJiraServerInfo(
  rawServerInfo: RawJiraServerInfo,
  configuredBaseUrl: string,
  deploymentHint: JiraDeploymentType,
): JiraServerInfo {
  const buildNumber =
    typeof rawServerInfo.buildNumber === "number"
      ? rawServerInfo.buildNumber
      : rawServerInfo.buildNumber && /^\d+$/.test(rawServerInfo.buildNumber)
        ? Number(rawServerInfo.buildNumber)
        : undefined;

  return {
    baseUrl: configuredBaseUrl,
    deploymentType: resolveDeploymentType(
      configuredBaseUrl,
      deploymentHint,
      rawServerInfo.deploymentType,
    ),
    versionNumbers: rawServerInfo.versionNumbers ?? [],
    ...(rawServerInfo.version ? { version: rawServerInfo.version } : {}),
    ...(buildNumber === undefined ? {} : { buildNumber }),
    ...(rawServerInfo.serverTitle ? { serverTitle: rawServerInfo.serverTitle } : {}),
    ...(rawServerInfo.serverTime ? { serverTime: rawServerInfo.serverTime } : {}),
  };
}

export function mapJiraProject(rawProject: RawJiraProject): JiraProject {
  const avatarUrl = rawProject.avatarUrls?.["48x48"] ?? rawProject.avatarUrls?.["32x32"];
  return {
    id: String(rawProject.id),
    key: rawProject.key,
    name: rawProject.name,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(rawProject.projectTypeKey ? { projectTypeKey: rawProject.projectTypeKey } : {}),
    ...(rawProject.simplified === undefined ? {} : { simplified: rawProject.simplified }),
  };
}

export function mapJiraField(rawField: RawJiraField): JiraField {
  return {
    id: rawField.id,
    name: rawField.name,
    custom: rawField.custom ?? rawField.id.startsWith("customfield_"),
    clauseNames: rawField.clauseNames ?? [],
    ...(rawField.searchable === undefined ? {} : { searchable: rawField.searchable }),
    ...(rawField.schema
      ? {
          schema: {
            ...(rawField.schema.type ? { type: rawField.schema.type } : {}),
            ...(rawField.schema.custom ? { custom: rawField.schema.custom } : {}),
            ...(rawField.schema.system ? { system: rawField.schema.system } : {}),
          },
        }
      : {}),
  };
}

function statusCategory(key?: string, name?: string): JiraStatusCategory {
  const value = `${key ?? ""} ${name ?? ""}`.toLowerCase();
  if (/\bdone\b|complete|resolved/.test(value)) {
    return "done";
  }
  if (/indeterminate|in.?progress/.test(value)) {
    return "in-progress";
  }
  if (/\bnew\b|to.?do|open/.test(value)) {
    return "to-do";
  }
  return "unknown";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sprintState(value: unknown): JiraSprintState {
  switch (optionalString(value)?.toLowerCase()) {
    case "active":
      return "active";
    case "future":
      return "future";
    case "closed":
      return "closed";
    default:
      return "unknown";
  }
}

function objectSprint(value: object): JiraIssueSprint | undefined {
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "number" ? String(record.id) : optionalString(record.id);
  const name = optionalString(record.name);
  if (!id || !name) {
    return undefined;
  }
  const rawBoardId = record.boardId ?? record.rapidViewId;
  const boardId =
    typeof rawBoardId === "number" ? String(rawBoardId) : optionalString(rawBoardId);
  const startDate = optionalString(record.startDate);
  const endDate = optionalString(record.endDate);
  const completeDate = optionalString(record.completeDate);
  return {
    id,
    name,
    state: sprintState(record.state),
    ...(boardId ? { boardId } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(completeDate ? { completeDate } : {}),
  };
}

function legacySprint(value: string): JiraIssueSprint | undefined {
  const details = value.match(/\[([^\]]+)]/)?.[1];
  if (!details) {
    return undefined;
  }
  const fields: Record<string, string> = Object.fromEntries(
    details
      .split(/,(?=[A-Za-z][A-Za-z0-9]*=)/)
      .map((part): [string, string] => {
        const [key, fieldValue = ""] = part.split(/=(.*)/s);
        return [key ?? "", fieldValue];
      })
      .filter(([key, fieldValue]) => Boolean(key && fieldValue)),
  );
  const id = optionalString(fields.id);
  const name = optionalString(fields.name);
  if (!id || !name) {
    return undefined;
  }
  const boardId = optionalString(fields.rapidViewId ?? fields.boardId);
  const startDate = optionalString(fields.startDate);
  const endDate = optionalString(fields.endDate);
  const completeDate = optionalString(fields.completeDate);
  return {
    id,
    name,
    state: sprintState(fields.state),
    ...(boardId ? { boardId } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(completeDate ? { completeDate } : {}),
  };
}

function mapSprints(value: unknown): JiraIssueSprint[] {
  const values: unknown[] = Array.isArray(value)
    ? (value as unknown[])
    : value == null
      ? []
      : [value];
  const sprints = values.flatMap((candidate) => {
    if (typeof candidate === "string") {
      const sprint = legacySprint(candidate);
      return sprint ? [sprint] : [];
    }
    if (candidate && typeof candidate === "object") {
      const sprint = objectSprint(candidate);
      return sprint ? [sprint] : [];
    }
    return [];
  });
  return [...new Map(sprints.map((sprint) => [sprint.id, sprint])).values()];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function referencedIssue(value: unknown): NormalizedHierarchyReference | undefined {
  if (typeof value === "string") {
    const key = optionalString(value);
    return key ? { key } : undefined;
  }
  const record = objectRecord(value);
  const key = optionalString(record?.key);
  if (!record || !key) {
    return undefined;
  }
  const rawId = record.id;
  const id = typeof rawId === "number" ? String(rawId) : optionalString(rawId);
  const fields = objectRecord(record.fields);
  const summary = optionalString(fields?.summary);
  const issueTypeValue = objectRecord(fields?.issuetype);
  const issueTypeId =
    typeof issueTypeValue?.id === "number"
      ? String(issueTypeValue.id)
      : optionalString(issueTypeValue?.id);
  const issueTypeName = optionalString(issueTypeValue?.name);
  const hierarchyLevelValue = issueTypeValue?.hierarchyLevel;
  const hierarchyLevel =
    typeof hierarchyLevelValue === "number" && Number.isInteger(hierarchyLevelValue)
      ? hierarchyLevelValue
      : undefined;
  const issueTypeIconUrl = optionalString(issueTypeValue?.iconUrl);
  const statusValue = objectRecord(fields?.status);
  const statusId =
    typeof statusValue?.id === "number"
      ? String(statusValue.id)
      : optionalString(statusValue?.id);
  const statusName = optionalString(statusValue?.name);
  const statusCategoryValue = objectRecord(statusValue?.statusCategory);

  return {
    ...(id ? { id } : {}),
    key,
    ...(summary ? { summary } : {}),
    ...(issueTypeId && issueTypeName
      ? {
          issueType: {
            id: issueTypeId,
            name: issueTypeName,
            subtask: issueTypeValue?.subtask === true,
            ...(hierarchyLevel === undefined ? {} : { hierarchyLevel }),
            ...(issueTypeIconUrl ? { iconUrl: issueTypeIconUrl } : {}),
          },
        }
      : {}),
    ...(statusName
      ? {
          status: {
            ...(statusId ? { id: statusId } : {}),
            name: statusName,
            category: statusCategory(
              optionalString(statusCategoryValue?.key),
              optionalString(statusCategoryValue?.name),
            ),
          },
        }
      : {}),
  };
}

function semanticLinkType(
  typeName: string,
  relationshipText: string | undefined,
  direction: NormalizedIssueLink["direction"],
): NormalizedIssueLink["semanticType"] {
  const phrase = relationshipText ?? "";
  switch (classifyIssueLinkRelationship(typeName, phrase, phrase)) {
    case "blocks":
      return direction === "outward" ? "blocks" : "is-blocked-by";
    case "finish-to-finish":
      return "finish-to-finish";
    case "duplicate":
      return direction === "outward" ? "duplicates" : "is-duplicated-by";
    case "depends":
      return "depends-on";
    case "relates":
      return "relates-to";
    default:
      return "unknown";
  }
}

function mapIssueLinks(rawIssue: RawJiraIssue): NormalizedIssueLink[] {
  return (rawIssue.fields.issuelinks ?? []).flatMap((link) => {
    const direction = link.outwardIssue ? "outward" : "inward";
    const linkedIssue = link.outwardIssue ?? link.inwardIssue;
    if (!linkedIssue) {
      return [];
    }
    const relationshipText =
      direction === "outward" ? link.type.outward : link.type.inward;
    return [
      {
        ...(link.id === undefined ? {} : { id: String(link.id) }),
        typeName: link.type.name,
        direction,
        linkedIssueKey: linkedIssue.key,
        ...(relationshipText ? { relationshipText } : {}),
        semanticType: semanticLinkType(link.type.name, relationshipText, direction),
      },
    ];
  });
}

function mapProgress(
  rawIssue: RawJiraIssue,
  category: JiraStatusCategory,
): NonNullable<NormalizedIssue["progress"]> {
  const progress = rawIssue.fields.progress;
  if (progress && progress.total > 0) {
    return {
      completed: progress.progress,
      total: progress.total,
      percentage: Math.min(100, Math.round((progress.progress / progress.total) * 100)),
      source: "jira-progress",
    };
  }

  const percentage = category === "done" ? 100 : category === "in-progress" ? 50 : 0;
  return {
    completed: percentage,
    total: 100,
    percentage,
    source: category === "unknown" ? "none" : "status",
  };
}

export interface IssueMappingContext {
  baseUrl: string;
  fieldMapping?: FieldMapping;
}

export function mapJiraIssue(
  rawIssue: RawJiraIssue,
  context: IssueMappingContext,
): NormalizedIssue {
  const fields = rawIssue.fields;
  const category = statusCategory(
    fields.status.statusCategory?.key,
    fields.status.statusCategory?.name,
  );
  const configuredStart = context.fieldMapping?.startDateFieldId
    ? fields[context.fieldMapping.startDateFieldId]
    : undefined;
  const configuredEnd = context.fieldMapping?.endDateFieldId
    ? fields[context.fieldMapping.endDateFieldId]
    : undefined;
  const configuredHierarchy = context.fieldMapping?.hierarchyFieldId
    ? fields[context.fieldMapping.hierarchyFieldId]
    : undefined;
  const storyPoints = context.fieldMapping?.storyPointsFieldId
    ? optionalNumber(fields[context.fieldMapping.storyPointsFieldId])
    : undefined;
  const originalEstimateSeconds = optionalNumber(fields.timeoriginalestimate);
  const sprints = context.fieldMapping?.sprintFieldId
    ? mapSprints(fields[context.fieldMapping.sprintFieldId])
    : [];
  const startDate = optionalString(configuredStart) ?? optionalString(fields.startdate);
  const dueDate = optionalString(configuredEnd) ?? optionalString(fields.duedate);
  const parentReference = referencedIssue(fields.parent);
  const epicReference = referencedIssue(configuredHierarchy);
  const parentKey = parentReference?.key;
  const epicKey = epicReference?.key;
  const baseUrl = context.baseUrl.replace(/\/+$/, "");

  return {
    id: String(rawIssue.id),
    key: rawIssue.key,
    ...(rawIssue.self ? { selfUrl: rawIssue.self } : {}),
    browseUrl: `${baseUrl}/browse/${encodeURIComponent(rawIssue.key)}`,
    summary: fields.summary,
    issueType: {
      id: String(fields.issuetype.id),
      name: fields.issuetype.name,
      subtask: fields.issuetype.subtask ?? false,
      ...(fields.issuetype.hierarchyLevel === undefined
        ? {}
        : { hierarchyLevel: fields.issuetype.hierarchyLevel }),
      ...(fields.issuetype.iconUrl ? { iconUrl: fields.issuetype.iconUrl } : {}),
    },
    status: {
      ...(fields.status.id === undefined ? {} : { id: String(fields.status.id) }),
      name: fields.status.name,
      category,
    },
    ...(fields.priority
      ? {
          priority: {
            ...(fields.priority.id === undefined
              ? {}
              : { id: String(fields.priority.id) }),
            name: fields.priority.name,
          },
        }
      : {}),
    ...(fields.assignee ? { assignee: mapJiraUser(fields.assignee) } : {}),
    ...(fields.reporter ? { reporter: mapJiraUser(fields.reporter) } : {}),
    project: {
      id: String(fields.project.id),
      key: fields.project.key,
      ...(fields.project.name ? { name: fields.project.name } : {}),
    },
    ...(parentKey ? { parentKey } : {}),
    ...(epicKey ? { epicKey } : {}),
    ...(parentReference ? { parentReference } : {}),
    ...(epicReference ? { epicReference } : {}),
    ...(fields.created ? { createdAt: fields.created } : {}),
    ...(fields.updated ? { updatedAt: fields.updated } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(fields.resolutiondate ? { resolvedAt: fields.resolutiondate } : {}),
    ...(storyPoints === undefined ? {} : { storyPoints }),
    ...(originalEstimateSeconds === undefined ? {} : { originalEstimateSeconds }),
    ...(sprints.length > 0 ? { sprints } : {}),
    progress: mapProgress(rawIssue, category),
    labels: [...(fields.labels ?? [])],
    components: (fields.components ?? []).map((component) => component.name),
    fixVersions: (fields.fixVersions ?? []).map((version) => version.name),
    issueLinks: mapIssueLinks(rawIssue),
    rawFieldPresence: {
      hasStartDate: startDate !== undefined,
      hasDueDate: dueDate !== undefined,
      hasParent: parentKey !== undefined,
      hasEpic: epicKey !== undefined,
    },
  };
}
