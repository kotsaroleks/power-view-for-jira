import { GitHubDayOffStore, type GitHubDayOffConfig } from "./GitHubDayOffStore";
import type { DayOffStore } from "./DayOffStore";
declare const __DAY_OFF_GITHUB_CONFIG__: GitHubDayOffConfig | null;
const origins = ["https://api.github.com/*"];
let shared: DayOffStore | undefined;
export function browserDayOffStore(): DayOffStore | undefined {
  const config =
    typeof __DAY_OFF_GITHUB_CONFIG__ === "undefined" ? null : __DAY_OFF_GITHUB_CONFIG__;
  if (!config) return undefined;
  return (shared ??= new GitHubDayOffStore({
    ...config,
    ensureAccess: async () => {
      if (
        typeof chrome !== "undefined" &&
        chrome.permissions &&
        !(await chrome.permissions.contains({ origins }))
      )
        throw new Error("Allow GitHub storage access to load Day Off.");
    },
  }));
}
export async function grantGitHubDayOffAccess() {
  if (
    typeof chrome !== "undefined" &&
    chrome.permissions &&
    !(await chrome.permissions.contains({ origins }))
  ) {
    if (!(await chrome.permissions.request({ origins })))
      throw new Error("GitHub storage access was not granted.");
  }
}
