import { z } from "zod";

const idSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);

export const rawJiraBoardSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(512),
    type: z.string().max(64).optional(),
    location: z
      .object({ projectKey: z.string().max(255).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const rawJiraBoardPageSchema = z
  .object({
    values: z.array(rawJiraBoardSchema),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export const rawJiraBoardConfigurationSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().max(512).optional(),
    filter: z.object({ id: idSchema.optional() }).passthrough().optional(),
    columnConfig: z
      .object({
        columns: z
          .array(
            z
              .object({
                statuses: z.array(z.object({ id: idSchema.optional() }).passthrough()).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    estimation: z
      .object({ field: z.object({ fieldId: z.string().optional() }).passthrough().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const rawJiraSprintSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(512),
    state: z.string().max(64),
    originBoardId: idSchema.optional(),
    goal: z.string().max(10_000).optional(),
    startDate: z.string().max(128).optional(),
    endDate: z.string().max(128).optional(),
    completeDate: z.string().max(128).optional(),
  })
  .passthrough();

export const rawJiraSprintPageSchema = z
  .object({
    values: z.array(rawJiraSprintSchema),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const rawCloudReportingIssuePageSchema = z
  .object({
    issues: z.array(z.unknown()),
    nextPageToken: z.string().min(1).optional(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const rawDataCenterReportingIssuePageSchema = z
  .object({
    issues: z.array(z.unknown()),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

const rawChangeItemSchema = z
  .object({
    field: z.string().max(512).optional(),
    fieldId: z.string().max(512).optional(),
    from: z.unknown().optional(),
    fromString: z.string().nullable().optional(),
    to: z.unknown().optional(),
    toString: z.string().nullable().optional(),
  })
  .passthrough();

export const rawJiraChangelogEntrySchema = z
  .object({
    id: idSchema,
    created: z.string().max(128),
    author: z.unknown().optional(),
    items: z.array(rawChangeItemSchema),
  })
  .passthrough();

export const rawJiraIssueChangelogPageSchema = z
  .object({
    values: z.array(rawJiraChangelogEntrySchema),
    startAt: z.number().int().nonnegative().optional(),
    maxResults: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    isLast: z.boolean().optional(),
  })
  .passthrough();

export const rawCloudBulkChangelogSchema = z
  .object({
    issueChangeLogs: z.array(
      z
        .object({
          issueId: idSchema,
          changeHistories: z.array(rawJiraChangelogEntrySchema),
        })
        .passthrough(),
    ),
    nextPageToken: z.string().min(1).optional(),
  })
  .passthrough();

export const rawJiraWorklogSchema = z
  .object({
    id: idSchema,
    issueId: idSchema.optional(),
    author: z.unknown().optional(),
    started: z.string().max(128),
    timeSpentSeconds: z.number().nonnegative(),
    created: z.string().max(128).optional(),
    updated: z.string().max(128).optional(),
  })
  .passthrough();

export const rawJiraWorklogPageSchema = z
  .object({
    worklogs: z.array(rawJiraWorklogSchema),
    startAt: z.number().int().nonnegative(),
    maxResults: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .passthrough();

export type RawJiraBoard = z.infer<typeof rawJiraBoardSchema>;
export type RawJiraBoardConfiguration = z.infer<typeof rawJiraBoardConfigurationSchema>;
export type RawJiraSprint = z.infer<typeof rawJiraSprintSchema>;
export type RawJiraChangelogEntry = z.infer<typeof rawJiraChangelogEntrySchema>;
export type RawJiraWorklog = z.infer<typeof rawJiraWorklogSchema>;
