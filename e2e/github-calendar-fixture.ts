import type { BrowserContext, Page } from "@playwright/test";

/** All GitHub traffic is intercepted; no real calendar or token is used. */
export async function installGitHubCalendarFixture(
  page: Page | BrowserContext,
  available = true,
) {
  const files = new Map<string, { sha: string; data: Record<string, unknown> }>();
  let revision = 0;
  let writes = 0;
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!available) {
      await route.fulfill({ status: 503, json: { message: "Fixture unavailable" } });
      return;
    }
    if (path.includes("/branches/")) {
      await route.fulfill({
        json: {
          name: decodeURIComponent(path.split("/branches/")[1]!),
          commit: { sha: "fixture" },
        },
      });
      return;
    }
    if (!path.includes("/contents/")) throw new Error("Unexpected fixture GitHub API");
    const file = files.get(path);
    if (request.method() === "GET") {
      await route.fulfill(
        file
          ? {
              json: {
                type: "file",
                sha: file.sha,
                encoding: "base64",
                content: Buffer.from(JSON.stringify(file.data)).toString("base64"),
              },
            }
          : { status: 404, json: { message: "Not Found" } },
      );
      return;
    }
    if (request.method() !== "PUT") throw new Error("Unexpected calendar mutation");
    const body = request.postDataJSON() as { content: string; sha?: string };
    if (body.sha !== file?.sha) {
      await route.fulfill({ status: 409, json: { message: "Conflict" } });
      return;
    }
    const sha = `fixture-${++revision}`;
    files.set(path, {
      sha,
      data: JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as Record<
        string,
        unknown
      >,
    });
    writes++;
    await route.fulfill({ status: file ? 200 : 201, json: { content: { sha } } });
  });
  return {
    setAvailable: (value: boolean) => {
      available = value;
    },
    writes: () => writes,
    seed: (baseUrl: string, accountId: string, month: string, dates: string[]) => {
      const hex = (value: string) => Buffer.from(value).toString("hex");
      files.set(
        `/repos/fixture/calendar/contents/powerview/day-off/${hex(baseUrl)}/${hex(accountId)}/${month}.json`,
        {
          sha: `fixture-${++revision}`,
          data: {
            schemaVersion: 1,
            jiraBaseUrl: baseUrl,
            jiraAccountId: accountId,
            month,
            dates,
            updatedAt: "2026-11-03T12:00:00Z",
          },
        },
      );
    },
  };
}
