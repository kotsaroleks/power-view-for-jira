"""Configuration regressions: do not replace the schedule with an unusable calendar."""
import base64
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("report_setup", Path(__file__).with_name("configure-description-report.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class MorningDeploymentTests(unittest.TestCase):
    def config(self):
        return {"schemaVersion": 1, "jiraBaseUrl": "https://fixture.atlassian.net",
                "boardId": "7", "expectedJiraAccountId": "fixture", "chatSpace": "fixture-space",
                "firstReportDate": "2026-11-09"}

    def test_legacy_local_config_cannot_replace_morning_workflow(self):
        local = {"repository": "fixture/private-automation", "config": self.config()}
        with patch.object(setup, "resolve_jira_credential", return_value=local), patch.object(setup, "GitHub") as github:
            with self.assertRaisesRegex(RuntimeError, "morningReports"):
                setup.deploy(local)
        github.assert_not_called()

    def test_weekend_start_is_rejected_before_deployment(self):
        config = self.config()
        config["morningReports"] = {"calendar": "kyiv-workdays-08-v1", "firstReportDate": "2026-11-08"}
        with self.assertRaisesRegex(RuntimeError, "Monday"):
            setup.validate_config(config)

    def test_morning_example_uses_supported_weekday_calendar(self):
        config = self.config()
        config["morningReports"] = {"calendar": "kyiv-workdays-08-v1", "firstReportDate": "2026-11-10"}
        setup.validate_config(config)

    def test_reconfiguration_preserves_the_selected_timer(self):
        config = self.config()
        config["morningReports"] = {"calendar": "kyiv-calendar-days-00-v1", "firstReportDate": "2026-11-12"}
        local = {"repository": "fixture/private-automation", "config": config}
        repo = "/repos/" + local["repository"]
        template = (setup.ROOT / "automation/description-report/workflow.yml").read_text()
        cloudflare_workflow = template.replace(setup.GITHUB_PRIMARY_SCHEDULE, setup.CLOUDFLARE_PRIMARY_SCHEDULE)
        for workflow in (template, cloudflare_workflow):
            with self.subTest(cloudflare=workflow == cloudflare_workflow):
                with patch.object(setup, "resolve_jira_credential", return_value=local), \
                        patch.object(setup, "GitHub") as github, \
                        patch.object(Path, "is_file", return_value=True), \
                        patch.object(Path, "read_text", return_value=template), \
                        patch.dict(setup.os.environ, {}, clear=True):
                    github.return_value.api.side_effect = [
                        {"login": "fixture"},
                        {"private": True, "default_branch": "main"},
                        {"content": base64.b64encode(setup.MARKER.encode()).decode()},
                        {"object": {"sha": "head"}},
                        {"tree": {"sha": "old-tree"}},
                        {"content": base64.b64encode(workflow.encode()).decode()},
                        {"sha": "new-tree"},
                        {"sha": "new-head"},
                        None,
                        None,
                        None,
                    ]
                    setup.deploy(local)
                tree = next(call.args[2]["tree"] for call in github.return_value.api.call_args_list
                            if call.args[:2] == ("POST", repo + "/git/trees"))
                files = {file["path"]: file["content"] for file in tree}
                self.assertEqual(files[setup.DAILY_WORKFLOW_PATH], workflow)
                self.assertEqual("Cloudflare starts" in files["README.md"], workflow == cloudflare_workflow)


if __name__ == "__main__":
    unittest.main()
