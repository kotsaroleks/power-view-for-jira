/** Detect the extension platform from its own URL, without user-agent sniffing. */
export function isSafariExtension(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime?.getURL === "function" &&
    new URL(chrome.runtime.getURL("/")).protocol === "safari-web-extension:"
  );
}
