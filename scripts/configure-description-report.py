#!/usr/bin/env python3
"""Deploy the reviewed worker to an owner-only private repository. Never print secrets.

Requires PyNaCl when uploading protected settings. Local inputs live under .secrets.
No browser, native app, system dialog or desktop input is launched by this command.
"""
import argparse
import base64
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
MARKER = "power-view-description-report-v1"


def github_token():
    if os.environ.get("GH_TOKEN"):
        return os.environ["GH_TOKEN"]
    result = subprocess.run(["git", "-c", "credential.interactive=never", "credential", "fill"],
                            input="protocol=https\nhost=github.com\n\n", text=True,
                            capture_output=True, timeout=20,
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    fields = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if not fields.get("password"):
        raise RuntimeError("Existing GitHub authentication is unavailable.")
    return fields["password"]


class GitHub:
    def __init__(self):
        self.token = github_token()

    def api(self, method, path, body=None, missing=False):
        request = Request("https://api.github.com" + path, method=method,
                          data=None if body is None else json.dumps(body).encode(), headers={
                              "Authorization": "Bearer " + self.token,
                              "Accept": "application/vnd.github+json",
                              "Content-Type": "application/json",
                              "X-GitHub-Api-Version": "2022-11-28",
                              "User-Agent": "PowerView-description-report-setup"})
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as error:
            if missing and error.code == 404:
                return None
            raise RuntimeError("GitHub setup request failed: HTTP " + str(error.code)) from None

    def secret(self, repository, name, value):
        try:
            from nacl import encoding, public
        except ImportError:
            raise RuntimeError("Install PyNaCl in the protected setup environment before uploading credentials.") from None
        key = self.api("GET", "/repos/" + repository + "/actions/secrets/public-key")
        box = public.SealedBox(public.PublicKey(key["key"].encode(), encoding.Base64Encoder()))
        encrypted = base64.b64encode(box.encrypt(value.encode())).decode()
        self.api("PUT", "/repos/" + repository + "/actions/secrets/" + name,
                 {"key_id": key["key_id"], "encrypted_value": encrypted})


def validate_config(config):
    url = urlsplit(config["jiraBaseUrl"])
    if (url.scheme != "https" or not (url.hostname or "").endswith(".atlassian.net")
            or url.port not in (None, 443) or url.username or url.password or url.query or url.fragment or url.path not in ("", "/")):
        raise RuntimeError("Select an HTTPS Jira Cloud site.")
    if not re.fullmatch(r"[0-9]+", config["boardId"]):
        raise RuntimeError("Select a numeric Jira board ID.")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", config["chatSpace"]):
        raise RuntimeError("Select the Google Chat space ID.")
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", config["firstReportDate"]):
        raise RuntimeError("Select the first scheduled report date.")
    try:
        date.fromisoformat(config["firstReportDate"])
    except ValueError:
        raise RuntimeError("Select a valid first report date.") from None


def verify_jira(config, email, token):
    authorization = "Basic " + base64.b64encode((email + ":" + token).encode()).decode()
    request = Request(config["jiraBaseUrl"].rstrip("/") + "/rest/api/3/myself",
                      headers={"Authorization": authorization, "Accept": "application/json"})
    # Jira credentials never follow redirects to a different destination.
    from urllib.request import HTTPRedirectHandler, build_opener
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            user = json.load(response)
    except Exception:
        raise RuntimeError("The supplied Jira credential could not be verified. It was not enabled for delivery.") from None
    if not user.get("accountId"):
        raise RuntimeError("Jira did not confirm the current account.")
    config["expectedJiraAccountId"] = user["accountId"]


def verify_report_read(config, email, token, bundle):
    """Exercise the production worker read-only before enabling its schedule."""
    with tempfile.TemporaryDirectory(prefix="power-view-report-verify-") as directory:
        path = Path(directory) / "config.json"
        path.write_text(json.dumps(config))
        path.chmod(0o600)
        env = {**os.environ, "REPORT_CONFIG_PATH": str(path), "JIRA_EMAIL": email, "JIRA_API_TOKEN": token}
        env.pop("REPORT_PREVIEW_PATH", None)
        result = subprocess.run([os.environ.get("POWER_VIEW_NODE", "node"), str(bundle), "--preview-only"],
                                env=env, capture_output=True, text=True, timeout=600)
        if result.returncode:
            raise RuntimeError("The full read-only Jira report check failed. Delivery remains disabled.")
        try:
            return json.loads(result.stdout.strip())
        except ValueError:
            raise RuntimeError("The report read check did not return a confirmed result.") from None


def deploy(local, enable=False):
    repository = local["repository"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError("Choose an owner/private-repository name.")
    config = dict(local["config"])
    validate_config(config)
    email = local.get("jiraEmail") or os.environ.get("JIRA_EMAIL")
    token = local.get("jiraToken") or os.environ.get("JIRA_API_TOKEN")
    webhook = (local.get("webhook") or os.environ.get("GOOGLE_CHAT_WEBHOOK_URL") or "").strip()
    if token and not email:
        raise RuntimeError("Both Jira email and token are required when configuring access.")
    if email and token:
        verify_jira(config, email, token)
    if webhook:
        url = urlsplit(webhook)
        from urllib.parse import parse_qs
        query = parse_qs(url.query)
        if (url.scheme != "https" or url.netloc != "chat.googleapis.com"
                or url.path != "/v1/spaces/" + config["chatSpace"] + "/messages"
                or url.fragment or not query.get("key") or not query.get("token")
                or set(query) != {"key", "token"}):
            raise RuntimeError("The webhook does not belong to the selected Google Chat space.")
        config["chatWebhookFingerprint"] = hashlib.sha256(webhook.encode()).hexdigest()
    if enable and not (email and token and webhook):
        raise RuntimeError("Verified Jira access and the selected Chat webhook are required before enabling delivery.")
    bundle = ROOT / "dist/report-bot/description-report.mjs"
    if not bundle.is_file():
        raise RuntimeError("Build the report worker before deploying it.")
    if email or token or webhook:
        try:
            import nacl.public  # noqa: F401 -- preflight before any remote mutation
        except ImportError:
            raise RuntimeError("Install PyNaCl in the protected setup environment before uploading credentials.") from None
    read_check = verify_report_read(config, email, token, bundle) if enable else None
    gh = GitHub()
    owner, name = repository.split("/")
    if gh.api("GET", "/user")["login"].lower() != owner.lower():
        raise RuntimeError("The automation repository must belong to the authenticated user.")
    repo = gh.api("GET", "/repos/" + repository, missing=True)
    if repo is None:
        repo = gh.api("POST", "/user/repos", {"name": name, "private": True,
                     "description": "Private Power View daily Jira description report delivery", "auto_init": True})
    else:
        marker = gh.api("GET", "/repos/" + repository + "/contents/.power-view-report-automation", missing=True)
        if not marker or base64.b64decode(marker.get("content", "")).decode().strip() != MARKER:
            raise RuntimeError("The existing repository is not marked as this report automation. It was left unchanged.")
    if not repo.get("private"):
        raise RuntimeError("Report automation must stay in a private repository.")
    branch = repo["default_branch"]
    if branch != "main":
        head = gh.api("GET", "/repos/" + repository + "/git/ref/heads/" + branch)
        gh.api("POST", "/repos/" + repository + "/git/refs", {"ref": "refs/heads/main", "sha": head["object"]["sha"]})
        gh.api("PATCH", "/repos/" + repository, {"default_branch": "main"})
    ref = gh.api("GET", "/repos/" + repository + "/git/ref/heads/main")
    commit = gh.api("GET", "/repos/" + repository + "/git/commits/" + ref["object"]["sha"])
    files = {
        ".power-view-report-automation": MARKER + "\n",
        "bot/description-report.mjs": bundle.read_text(),
        "config.json": json.dumps(config, indent=2) + "\n",
        ".github/workflows/daily-description-report.yml": (ROOT / "automation/description-report/workflow.yml").read_text(),
        "README.md": "# Power View daily description report\n\nPrivate automation and delivery state. Schedule: 21:00 Europe/Kyiv; recovery: 21:20.\n\nREPORT_ENABLED controls delivery. Jira and Chat credentials are encrypted Actions secrets. The source and tests live in kotsaroleks/power-view-for-jira. No credentials belong in this repository's files.\n",
    }
    tree = gh.api("POST", "/repos/" + repository + "/git/trees", {"base_tree": commit["tree"]["sha"],
                  "tree": [{"path": path, "mode": "100644", "type": "blob", "content": content} for path, content in files.items()]})
    created = gh.api("POST", "/repos/" + repository + "/git/commits", {"message": "Deploy verified daily description report worker", "tree": tree["sha"], "parents": [ref["object"]["sha"]]})
    gh.api("PATCH", "/repos/" + repository + "/git/refs/heads/main", {"sha": created["sha"], "force": False})
    if email and token:
        gh.secret(repository, "JIRA_EMAIL", email)
        gh.secret(repository, "JIRA_API_TOKEN", token)
    if webhook:
        gh.secret(repository, "GOOGLE_CHAT_WEBHOOK_URL", webhook)
    variable = gh.api("GET", "/repos/" + repository + "/actions/variables/REPORT_ENABLED", missing=True)
    value = "true" if enable else "false"
    if variable:
        gh.api("PATCH", "/repos/" + repository + "/actions/variables/REPORT_ENABLED", {"name": "REPORT_ENABLED", "value": value})
    else:
        gh.api("POST", "/repos/" + repository + "/actions/variables", {"name": "REPORT_ENABLED", "value": value})
    return {"repository": "https://github.com/" + repository, "commit": created["sha"], "deliveryEnabled": enable,
            "jiraConfigured": bool(email and token), "chatConfigured": bool(webhook), "readCheck": read_check}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(ROOT / ".secrets/description-report.local.json"))
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()
    path = Path(args.config)
    if not path.is_file():
        raise RuntimeError("Create the protected local configuration before deploying the report.")
    if path.stat().st_mode & 0o077:
        raise RuntimeError("Protect the local setup file with chmod 600 before reading credentials.")
    result = deploy(json.loads(path.read_text()), args.enable)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Report setup stopped: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
