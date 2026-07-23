# Extension permissions

Milestone 8 uses these Chrome permissions:

- `activeTab`: inspect the page on which the user opened the popup;
- `storage`: keep versioned, non-secret context in `chrome.storage.session` and setup
  configuration in `chrome.storage.local`;
- `scripting`: register and inject the packaged context detector after custom-host
  approval.

The extension uses basic `chrome.tabs` operations to refresh context and reuse the Power
View tab; those operations do not require the broad `tabs` permission. Sensitive
active-page URL access is limited to the user gesture through `activeTab` or to an already
approved Jira host.

Jira Cloud pages on `https://*.atlassian.net/*` use the packaged static content script.
Custom Jira sites use the optional `https://*/*` declaration, but the UI and service
worker request only one normalized exact host pattern such as
`https://jira.example.com/*`. Denial is non-fatal.

The service worker verifies the exact approved origin again before every Jira REST
request. The extension does not request mandatory `host_permissions`, load remote code,
use the cookies API, or expose session values to the application tab.

The build validator fails if the permission set expands, mandatory host permissions
appear, extension CSP stops being self-only, static content-script scope changes, or
external connection points are introduced.
