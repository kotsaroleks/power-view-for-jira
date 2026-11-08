# Description report activation — 8 November 2026

The private GitHub Actions automation is enabled for the selected Jira board and Google
Chat space. Jira access was verified locally and independently from the GitHub runner. All
three runtime credentials are encrypted Actions secrets. No Google browser session is
required for webhook delivery.

Real Google Chat verification found that incoming webhooks reject `requestId` with HTTP
400, despite the generic create-message reference documenting that field. The sender now
uses the supported custom `messageId=client-<stable UUID>`. A real send returned HTTP 200;
the GitHub verification then confirmed the existing message through `409 ALREADY_EXISTS`
and saved its receipt privately. Retrying the same connection did not create another
message. Other HTTP 409 responses remain errors.

The corrected worker was deployed and the first normal delivery run succeeded. The
checkpoint advanced through the report dated 7 November, with no pending delivery. That
period had no description changes, so no daily table was sent. The separate connection
notification confirmed the selected Chat destination.

The primary schedule is 21:00 Europe/Kyiv; the 21:20 recovery check resumes pending or
missed periods. GitHub may start scheduled jobs late, but the report keeps its exact
intended Kyiv period. The Mac and Power View do not need to remain running. The temporary
local setup server has been stopped.

Validation for these corrections: 28 focused worker tests, bot TypeScript checks, ESLint,
the production worker build, and five network-free protected-setup tests passed. The saved
Jira credential is reused automatically without a system dialog; the setup page does not
expose it or ask for it again when available. The webhook-only path has explicit
regression coverage. All verification and configuration used APIs/background commands;
Safari and the native desktop were not controlled.

Private receipts, run identifiers and credentials remain outside the public source tree.
