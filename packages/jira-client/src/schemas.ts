import { z } from "zod";

export const rawJiraUserSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    displayName: z.string().min(1).max(512),
    emailAddress: z.email().optional(),
    active: z.boolean().optional(),
    avatarUrls: z.record(z.string(), z.url()).optional(),
  })
  .passthrough();

export const rawJiraServerInfoSchema = z
  .object({
    baseUrl: z.url().max(2048),
    version: z.string().max(128).optional(),
    versionNumbers: z.array(z.number().int().nonnegative()).max(8).optional(),
    buildNumber: z.union([z.number().int(), z.string()]).optional(),
    serverTitle: z.string().max(512).optional(),
    serverTime: z.string().max(128).optional(),
    deploymentType: z.string().max(64).optional(),
  })
  .passthrough();

const jiraIdSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);

export const rawJiraProjectSchema = z
  .object({
    id: jiraIdSchema,
    key: z.string().min(1).max(255),
    name: z.string().min(1).max(512),
    avatarUrls: z.record(z.string(), z.url()).optional(),
    projectTypeKey: z.string().max(128).optional(),
    simplified: z.boolean().optional(),
  })
  .passthrough();

export const rawCloudProjectPageSchema = z
  .object({
    values: z.array(rawJiraProjectSchema),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const rawDataCenterProjectsSchema = z.array(rawJiraProjectSchema);

export const rawJiraStatusSchema = z
  .object({
    id: jiraIdSchema,
    name: z.string().min(1).max(512),
  })
  .passthrough();

export const rawJiraStatusesSchema = z.array(rawJiraStatusSchema);

export const rawJiraProjectStatusesSchema = z.array(
  z
    .object({
      statuses: z.array(rawJiraStatusSchema).optional(),
    })
    .passthrough(),
);

export const rawJiraFieldSchema = z
  .object({
    id: z.string().min(1).max(512),
    name: z.string().min(1).max(512),
    custom: z.boolean().optional(),
    searchable: z.boolean().optional(),
    clauseNames: z.array(z.string().max(512)).optional(),
    schema: z
      .object({
        type: z.string().max(128).optional(),
        custom: z.string().max(512).optional(),
        system: z.string().max(512).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const rawJiraFieldsSchema = z.array(rawJiraFieldSchema);

export const rawJiraUsersSchema = z.array(rawJiraUserSchema);

export const rawJiraIssueEditMetadataSchema = z
  .object({
    fields: z.record(
      z.string(),
      z
        .object({
          key: z.string().max(512).optional(),
          name: z.string().min(1).max(512),
          required: z.boolean().optional(),
          operations: z.array(z.string().max(128)).optional(),
          schema: rawJiraFieldSchema.shape.schema,
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const rawJiraIssueLinkTypeSchema = z
  .object({
    id: jiraIdSchema,
    name: z.string().min(1).max(255),
    inward: z.string().min(1).max(512),
    outward: z.string().min(1).max(512),
  })
  .passthrough();

export const rawJiraIssueLinkTypesSchema = z
  .object({
    issueLinkTypes: z.array(rawJiraIssueLinkTypeSchema),
  })
  .passthrough();

const rawIssueUserSchema = rawJiraUserSchema.nullable();

const rawIssueReferenceSchema = z
  .object({
    id: jiraIdSchema.optional(),
    key: z.string().min(1).max(255),
  })
  .passthrough();

const rawIssueLinkSchema = z
  .object({
    id: jiraIdSchema.optional(),
    type: z
      .object({
        name: z.string().min(1).max(512),
        inward: z.string().max(512).optional(),
        outward: z.string().max(512).optional(),
      })
      .passthrough(),
    inwardIssue: rawIssueReferenceSchema.optional(),
    outwardIssue: rawIssueReferenceSchema.optional(),
  })
  .passthrough();

export const rawJiraIssueSchema = z
  .object({
    id: jiraIdSchema,
    key: z.string().min(1).max(255),
    self: z.url().max(2048).optional(),
    fields: z
      .object({
        summary: z.string().min(1).max(10_000),
        issuetype: z
          .object({
            id: jiraIdSchema,
            name: z.string().min(1).max(512),
            subtask: z.boolean().optional(),
            hierarchyLevel: z.number().int().optional(),
            iconUrl: z.url().max(2048).optional(),
          })
          .passthrough(),
        status: z
          .object({
            id: jiraIdSchema.optional(),
            name: z.string().min(1).max(512),
            statusCategory: z
              .object({
                key: z.string().max(128).optional(),
                name: z.string().max(512).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
        priority: z
          .object({
            id: jiraIdSchema.optional(),
            name: z.string().min(1).max(512),
          })
          .passthrough()
          .nullable()
          .optional(),
        assignee: rawIssueUserSchema.optional(),
        reporter: rawIssueUserSchema.optional(),
        project: z
          .object({
            id: jiraIdSchema,
            key: z.string().min(1).max(255),
            name: z.string().min(1).max(512).optional(),
          })
          .passthrough(),
        parent: rawIssueReferenceSchema.nullable().optional(),
        created: z.string().max(128).nullable().optional(),
        updated: z.string().max(128).nullable().optional(),
        duedate: z.string().max(128).nullable().optional(),
        resolutiondate: z.string().max(128).nullable().optional(),
        progress: z
          .object({
            progress: z.number().nonnegative(),
            total: z.number().nonnegative(),
          })
          .passthrough()
          .nullable()
          .optional(),
        labels: z.array(z.string().max(512)).optional(),
        components: z
          .array(z.object({ name: z.string().min(1).max(512) }).passthrough())
          .optional(),
        fixVersions: z
          .array(z.object({ name: z.string().min(1).max(512) }).passthrough())
          .optional(),
        issuelinks: z.array(rawIssueLinkSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const rawCloudIssueSearchPageSchema = z
  .object({
    issues: z.array(rawJiraIssueSchema),
    nextPageToken: z.string().min(1).max(4096).optional(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const rawDataCenterIssueSearchPageSchema = z
  .object({
    issues: z.array(rawJiraIssueSchema),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export type RawJiraUser = z.infer<typeof rawJiraUserSchema>;
export type RawJiraServerInfo = z.infer<typeof rawJiraServerInfoSchema>;
export type RawJiraProject = z.infer<typeof rawJiraProjectSchema>;
export type RawJiraProjectStatuses = z.infer<typeof rawJiraProjectStatusesSchema>;
export type RawJiraStatus = z.infer<typeof rawJiraStatusSchema>;
export type RawCloudProjectPage = z.infer<typeof rawCloudProjectPageSchema>;
export type RawJiraField = z.infer<typeof rawJiraFieldSchema>;
export type RawJiraIssueEditMetadata = z.infer<typeof rawJiraIssueEditMetadataSchema>;
export type RawJiraIssueLinkType = z.infer<typeof rawJiraIssueLinkTypeSchema>;
export type RawJiraIssue = z.infer<typeof rawJiraIssueSchema>;
export type RawCloudIssueSearchPage = z.infer<typeof rawCloudIssueSearchPageSchema>;
export type RawDataCenterIssueSearchPage = z.infer<
  typeof rawDataCenterIssueSearchPageSchema
>;
