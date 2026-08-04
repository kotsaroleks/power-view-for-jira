# Enterprise self-hosted updates

The extension is configured for Chrome's enterprise update channel:

```text
https://kotsaroleks.github.io/power-view-for-jira/updates.xml
```

The release workflow builds a signed CRX3 and publishes it with `updates.xml` to GitHub
Pages. The signing key is intentionally not stored in Git.

## One-time GitHub setup

1. Back up `.secrets/power-view-for-jira.pem` in the team's password manager. Losing it
   prevents future updates to the installed extension.
2. In the repository settings, add an Actions secret named `EXTENSION_PRIVATE_KEY` with
   the complete PEM contents, including the `BEGIN` and `END` lines.
3. Enable GitHub Pages with **GitHub Actions** as the source.
4. Configure Chrome Enterprise `ExtensionSettings` or `ExtensionInstallForcelist` for
   extension ID `fdamaaiccihofpoadiibmgkbioegclcb` and the update URL above.

The extension must be installed by enterprise policy for macOS/Windows. A manually loaded
unpacked extension cannot receive CRX updates. Chrome checks the update URL automatically;
the popup's **Check now** action invokes Chrome's native `runtime.requestUpdateCheck()`
when that API is available.

## Releasing an update

Increase the root `package.json` version (for example `0.2.0` to `0.2.1`) and push to
`main`. The `enterprise-pages.yml` workflow builds the extension, signs the CRX with the
Actions secret, generates `updates.xml`, and deploys both files to GitHub Pages.

Never commit the PEM file, put it in a ZIP, or replace it with a newly generated key.
