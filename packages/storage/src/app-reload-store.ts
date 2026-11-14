import { z } from "zod";

import { storedJiraContextSchema, type StorageArea } from "./context-store";

const RELOAD_KEY = "app-reload:v1";
const reloadSchema = z.object({
  requestedAt: z.iso.datetime(),
  tabId: z.number().int().nonnegative().optional(),
  context: storedJiraContextSchema.optional(),
});

/** A one-use handoff: extension reloads close app tabs and clear session storage. */
export class AppReloadStore {
  constructor(private readonly storage: StorageArea) {}

  async save(request: z.infer<typeof reloadSchema>): Promise<void> {
    await this.storage.set({ [RELOAD_KEY]: reloadSchema.parse(request) });
  }

  async take(now = Date.now()): Promise<z.infer<typeof reloadSchema> | undefined> {
    const stored = await this.storage.get(RELOAD_KEY);
    if (stored[RELOAD_KEY] === undefined) return undefined;
    await this.storage.remove(RELOAD_KEY);
    const parsed = reloadSchema.safeParse(stored[RELOAD_KEY]);
    if (!parsed.success) return undefined;
    const age = now - Date.parse(parsed.data.requestedAt);
    return age >= 0 && age < 60_000 ? parsed.data : undefined;
  }
}
