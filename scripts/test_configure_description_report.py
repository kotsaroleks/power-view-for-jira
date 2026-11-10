"""Configuration regressions: do not replace the schedule with an unusable calendar."""
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


if __name__ == "__main__":
    unittest.main()
