import type { BoardReportConfiguration } from "@power-view/domain";
import { z } from "zod";

import type { StorageArea } from "./context-store";

const REPORTING_SETTINGS_KEY = "reporting-settings:v1";

const boardReportConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    jiraBaseUrl: z.url().max(2048),
    boardId: z.string().regex(/^\d+$/),
    completedStatusIds: z.array(z.string().min(1).max(512)).max(100),
    completedStatusNames: z.array(z.string().min(1).max(512)).max(100),
    storyPointsFieldId: z.string().min(1).max(512).optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    boards: z.record(z.string(), boardReportConfigurationSchema),
  })
  .strict();

function normalizedBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function boardKey(baseUrl: string, boardId: string): string {
  return `${encodeURIComponent(normalizedBaseUrl(baseUrl))}:${boardId}`;
}

export class ReportSettingsStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageArea) {}

  async getBoardConfiguration(
    baseUrl: string,
    boardId: string,
  ): Promise<BoardReportConfiguration | undefined> {
    await this.writes;
    const state = await this.read();
    return state.boards[boardKey(baseUrl, boardId)] as BoardReportConfiguration | undefined;
  }

  saveBoardConfiguration(configuration: BoardReportConfiguration): Promise<void> {
    const write = this.writes.then(async () => {
      const state = await this.read();
      const parsed = stateSchema.parse({
        schemaVersion: 1,
        boards: {
          ...state.boards,
          [boardKey(configuration.jiraBaseUrl, configuration.boardId)]: configuration,
        },
      });
      await this.storage.set({ [REPORTING_SETTINGS_KEY]: parsed });
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  async removeBoardConfiguration(baseUrl: string, boardId: string): Promise<void> {
    const write = this.writes.then(async () => {
      const state = await this.read();
      const boards = { ...state.boards };
      delete boards[boardKey(baseUrl, boardId)];
      await this.storage.set({
        [REPORTING_SETTINGS_KEY]: stateSchema.parse({ schemaVersion: 1, boards }),
      });
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private async read(): Promise<z.infer<typeof stateSchema>> {
    const result = await this.storage.get(REPORTING_SETTINGS_KEY);
    const parsed = stateSchema.safeParse(result[REPORTING_SETTINGS_KEY]);
    return parsed.success ? parsed.data : { schemaVersion: 1, boards: {} };
  }
}
