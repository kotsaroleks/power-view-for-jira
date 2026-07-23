const HTTPS_PROTOCOL = "https:";

export function normalizeHostPermissionPattern(input: string): string {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new Error("Enter the HTTPS URL of your Jira site.");
  }

  const candidate = trimmedInput.includes("://")
    ? trimmedInput
    : `https://${trimmedInput}`;

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid Jira URL, such as https://jira.example.com.");
  }

  if (url.protocol !== HTTPS_PROTOCOL) {
    throw new Error("Custom Jira access requires HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("Jira URLs containing credentials are not allowed.");
  }

  if (url.port) {
    throw new Error("Custom Jira ports are not supported in this milestone.");
  }

  if (!url.hostname || url.hostname.includes("*")) {
    throw new Error("Wildcard Jira hosts are not allowed.");
  }

  return `${HTTPS_PROTOCOL}//${url.hostname}/*`;
}

export function isExactHttpsOriginPattern(value: string): boolean {
  try {
    return normalizeHostPermissionPattern(value) === value;
  } catch {
    return false;
  }
}
