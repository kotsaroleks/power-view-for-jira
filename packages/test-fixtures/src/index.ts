export const SANITIZED_FIXTURE_NAMESPACE = "power-view-example";

export const jiraCloudCurrentUserFixture = {
  accountId: "fixture-account-id",
  displayName: "Fixture Cloud User",
  active: true,
  avatarUrls: {
    "48x48": "https://avatar-management--avatars.example.test/avatar.png",
  },
} as const;

export const jiraCloudServerInfoFixture = {
  baseUrl: "https://fixture.atlassian.net",
  deploymentType: "Cloud",
  version: "1001.0.0",
  versionNumbers: [1001, 0, 0],
  buildNumber: 100100,
  serverTitle: "Fixture Jira Cloud",
} as const;

export const jiraDataCenterCurrentUserFixture = {
  key: "fixture-user-key",
  name: "fixture-user",
  displayName: "Fixture Data Center User",
  active: true,
} as const;

export const jiraDataCenterServerInfoFixture = {
  baseUrl: "https://jira.example.test",
  deploymentType: "Data Center",
  version: "10.7.1",
  versionNumbers: [10, 7, 1],
  buildNumber: 1007001,
  serverTitle: "Fixture Jira Data Center",
} as const;

export const jiraCloudProjectsFixture = {
  values: [
    {
      id: "10000",
      key: "POWER",
      name: "Power View",
      projectTypeKey: "software",
      simplified: false,
    },
  ],
  startAt: 0,
  maxResults: 25,
  total: 1,
  isLast: true,
} as const;

export const jiraDataCenterProjectsFixture = [
  {
    id: "10000",
    key: "POWER",
    name: "Power View",
    projectTypeKey: "software",
  },
] as const;

export const jiraFieldsFixture = [
  {
    id: "customfield_10010",
    name: "Planned Start",
    custom: true,
    searchable: true,
    schema: {
      type: "date",
      custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
    },
  },
  {
    id: "duedate",
    name: "Due date",
    custom: false,
    searchable: true,
    schema: { type: "date", system: "duedate" },
  },
  {
    id: "customfield_10014",
    name: "Epic Link",
    custom: true,
    searchable: true,
    schema: { type: "string" },
  },
] as const;

export function makeJiraIssueFixture(index: number) {
  const sequence = index + 1;
  const isDone = sequence % 3 === 0;
  return {
    id: String(20_000 + sequence),
    key: `POWER-${sequence}`,
    self: `https://fixture.atlassian.net/rest/api/3/issue/${20_000 + sequence}`,
    fields: {
      summary: `Sanitized planning issue ${sequence}`,
      issuetype: {
        id: sequence % 5 === 0 ? "10001" : "10000",
        name: sequence % 5 === 0 ? "Story" : "Task",
        subtask: false,
        hierarchyLevel: 0,
      },
      status: {
        id: isDone ? "3" : "1",
        name: isDone ? "Done" : "To Do",
        statusCategory: { key: isDone ? "done" : "new" },
      },
      priority: { id: "3", name: "Medium" },
      assignee: {
        accountId: `fixture-account-${sequence % 7}`,
        displayName: `Fixture User ${sequence % 7}`,
      },
      reporter: {
        accountId: "fixture-reporter",
        displayName: "Fixture Reporter",
      },
      project: { id: "10000", key: "POWER", name: "Power View" },
      created: "2026-01-01T10:00:00.000+0000",
      updated: "2026-01-02T10:00:00.000+0000",
      duedate: sequence % 4 === 0 ? null : "2026-02-10",
      resolutiondate: isDone ? "2026-02-09T10:00:00.000+0000" : null,
      customfield_10010: sequence % 6 === 0 ? null : "2026-02-01",
      labels: sequence % 2 === 0 ? ["fixture"] : [],
      components: [{ name: "Planning" }],
      fixVersions: [{ name: "Fixture 1.0" }],
      progress: isDone ? { progress: 100, total: 100 } : null,
      issuelinks: [],
    },
  };
}

export function makeJiraIssueFixtures(count = 1_000) {
  return Array.from({ length: count }, (_, index) => makeJiraIssueFixture(index));
}

export function makeJiraScheduleFixtures() {
  const epic = makeJiraIssueFixture(0);
  const story = makeJiraIssueFixture(1);
  const subtask = makeJiraIssueFixture(2);
  const blocker = makeJiraIssueFixture(3);
  const orphan = makeJiraIssueFixture(4);

  return [
    {
      ...epic,
      fields: {
        ...epic.fields,
        issuetype: {
          id: "10002",
          name: "Epic",
          subtask: false,
          hierarchyLevel: 1,
        },
        customfield_10010: null,
        duedate: null,
      },
    },
    {
      ...story,
      fields: {
        ...story.fields,
        issuetype: {
          id: "10001",
          name: "Story",
          subtask: false,
          hierarchyLevel: 0,
        },
        customfield_10014: "POWER-1",
        customfield_10010: "2026-02-02",
        duedate: "2026-02-12",
      },
    },
    {
      ...subtask,
      fields: {
        ...subtask.fields,
        issuetype: {
          id: "10003",
          name: "Sub-task",
          subtask: true,
          hierarchyLevel: -1,
        },
        parent: { id: story.id, key: story.key },
        customfield_10010: null,
        duedate: null,
      },
    },
    {
      ...blocker,
      fields: {
        ...blocker.fields,
        customfield_10010: "2026-01-28",
        duedate: "2026-02-01",
        issuelinks: [
          {
            id: "30001",
            type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
            outwardIssue: { id: story.id, key: story.key },
          },
        ],
      },
    },
    {
      ...orphan,
      fields: {
        ...orphan.fields,
        parent: { id: "29999", key: "POWER-999" },
        customfield_10010: "invalid-date",
        duedate: "2025-01-01",
      },
    },
  ];
}
