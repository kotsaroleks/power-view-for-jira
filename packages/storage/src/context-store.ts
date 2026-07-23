import type { JiraPageContext } from "@power-view/domain";
import { jiraPageContextSchema } from "@power-view/extension-messaging";
import { z } from "zod";

const LATEST_CONTEXT_KEY = "jira-context:latest";
const contextKey = (tabId: number) => `jira-context:tab:${tabId}`;

const storedJiraContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    tabId: z.number().int().nonnegative(),
    context: jiraPageContextSchema,
  })
  .strict();

export type StoredJiraContext = z.infer<typeof storedJiraContextSchema>;

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export class ContextStore {
  constructor(private readonly storage: StorageArea) {}

  async save(tabId: number, context: JiraPageContext): Promise<void> {
    const storedContext = storedJiraContextSchema.parse({
      schemaVersion: 1,
      tabId,
      context,
    });

    await this.storage.set({
      [LATEST_CONTEXT_KEY]: storedContext,
      [contextKey(tabId)]: storedContext,
    });
  }

  async getLatest(): Promise<StoredJiraContext | undefined> {
    return this.read(LATEST_CONTEXT_KEY);
  }

  async getForTab(tabId: number): Promise<StoredJiraContext | undefined> {
    return this.read(contextKey(tabId));
  }

  async removeForTab(tabId: number): Promise<void> {
    await this.storage.remove(contextKey(tabId));
    const latest = await this.getLatest();

    if (latest?.tabId === tabId) {
      await this.storage.remove(LATEST_CONTEXT_KEY);
    }
  }

  private async read(key: string): Promise<StoredJiraContext | undefined> {
    const result = await this.storage.get(key);
    const parsed = storedJiraContextSchema.safeParse(result[key]);
    return parsed.success ? parsed.data : undefined;
  }
}
