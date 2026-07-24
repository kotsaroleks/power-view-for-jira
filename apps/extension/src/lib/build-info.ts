import { z } from "zod";

const buildInfoSchema = z
  .object({
    schemaVersion: z.literal(1),
    commitSha: z.string().min(1).nullable(),
    commitShaShort: z.string().min(1).nullable(),
    repoOwner: z.string().min(1).nullable(),
    repoName: z.string().min(1).nullable(),
    builtAt: z.iso.datetime(),
    gitAvailable: z.boolean(),
  })
  .strict();

export type BuildInfo = z.infer<typeof buildInfoSchema>;

export async function getBuildInfo(
  fetchImpl: typeof fetch = fetch,
): Promise<BuildInfo | undefined> {
  try {
    const response = await fetchImpl(chrome.runtime.getURL("build-info.json"));
    if (!response.ok) {
      return undefined;
    }
    const parsed = buildInfoSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
