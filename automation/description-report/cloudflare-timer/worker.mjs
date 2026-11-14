/* global AbortSignal, console, fetch */

const workflowDispatchUrl =
  "https://api.github.com/repos/kotsaroleks/power-view-report-automation/actions/workflows/410459071/dispatches";

const kyivClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default {
  async scheduled({ scheduledTime }, { REPORT_MODE: mode, GITHUB_ACTIONS_TOKEN: token }) {
    if (mode !== "deliver" && mode !== "check") {
      throw new Error("Set REPORT_MODE to deliver or check");
    }

    // Cloudflare schedules in UTC. Use the nominal time so a late trigger still counts.
    // Check mode allows a one-off deployment test at any time without delivering a report.
    if (mode === "deliver" && kyivClock.format(scheduledTime) !== "00:05") {
      return;
    }

    if (!token) {
      throw new Error("Missing GITHUB_ACTIONS_TOKEN Worker secret");
    }

    let response;
    try {
      response = await fetch(workflowDispatchUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "Power-View-Report-Timer",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ ref: "main", inputs: { mode } }),
      });
    } catch {
      throw new Error("Could not confirm the workflow dispatch with GitHub");
    }

    if (response.status !== 200) {
      throw new Error(`GitHub workflow dispatch returned HTTP ${response.status}`);
    }

    const result = await response.json().catch(() => null);
    const runId = result?.workflow_run_id;
    if (!Number.isSafeInteger(runId) || runId < 1) {
      throw new Error("GitHub workflow dispatch did not return a run ID");
    }

    console.log("Dispatched Jira report workflow", {
      mode,
      scheduledAt: new Date(scheduledTime).toISOString(),
      runId,
    });
  },
};
