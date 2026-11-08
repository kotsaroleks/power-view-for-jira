"""Protected setup checks with in-memory HTTP requests; no services or saved logins."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode


spec = importlib.util.spec_from_file_location(
    "complete_description_report", Path(__file__).with_name("complete-description-report.py"))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

SESSION = {"route": "/setup/resumed-test-session", "nonce": "test-nonce-with-at-least-24-characters", "port": 8765}
ADDRESS = "127.0.0.1:8765"
WEBHOOK = "https://chat.googleapis.com/v1/spaces/example-space/messages?key=example-key&token=example-webhook-token"
LOCAL = {
    "repository": "example-owner/private-report",
    "jiraEmail": "saved-jira@example.invalid",
    "jiraToken": "saved-jira-token-DO-NOT-RENDER",
    "config": {"boardId": "42", "jiraBaseUrl": "https://example.atlassian.net", "chatSpace": "example-space"},
}


class MemorySocket:
    def __init__(self, request):
        self.request = request
        self.response = bytearray()

    def makefile(self, *_args):
        return io.BytesIO(self.request)

    def sendall(self, data):
        self.response.extend(data)


class ProtectedSetupTests(unittest.TestCase):
    def request(self, fields=None, *, origin=None, host=ADDRESS, route=None,
                deploy_error=None, dispatch_error=None):
        fields = fields if fields is not None else {"nonce": SESSION["nonce"], "webhook": WEBHOOK}
        body = urlencode(fields).encode()
        request = (f"POST {route or SESSION['route']} HTTP/1.1\r\n"
                   f"Host: {host}\r\nOrigin: {origin or 'http://' + ADDRESS}\r\n"
                   "Content-Type: application/x-www-form-urlencoded\r\n"
                   f"Content-Length: {len(body)}\r\n\r\n").encode() + body
        connection = MemorySocket(request)
        bound = []

        class MemoryServer:
            def __init__(self, address, handler):
                bound.append(address)
                self.server_port = address[1]
                self.handler = handler

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            def handle_request(self):
                self.handler(connection, ("127.0.0.1", 12345), self)
                self.done = True

        deploy = Mock(return_value={"repository": "https://github.com/" + LOCAL["repository"]},
                      side_effect=deploy_error)
        github = Mock()
        github.api.side_effect = dispatch_error
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            status_path = Path(directory) / "status.json"
            with patch.object(report, "HTTPServer", MemoryServer), \
                    patch.object(report.setup, "deploy", deploy), \
                    patch.object(report.setup, "GitHub", return_value=github), \
                    contextlib.redirect_stdout(output):
                report.serve(LOCAL, session=SESSION, status_path=status_path)
            status = json.loads(status_path.read_text())
        self.assertEqual(bound, [("127.0.0.1", SESSION["port"])])
        return connection.response.decode(), status, deploy, github, output.getvalue()

    def assert_credentials_hidden(self, text):
        for secret in (LOCAL["jiraEmail"], LOCAL["jiraToken"], WEBHOOK):
            self.assertNotIn(secret, text)

    def test_saved_jira_renders_webhook_only(self):
        html = report.form(LOCAL, SESSION["route"], SESSION["nonce"])
        self.assert_credentials_hidden(html)
        self.assertNotIn("name='email'", html)
        self.assertNotIn("name='jiraToken'", html)
        self.assertIn("name='webhook'", html)
        self.assertNotIn("accounts.google.com", html)

    def test_webhook_only_post_reuses_saved_jira_and_resumed_session(self):
        response, status, deploy, github, output = self.request()
        self.assertTrue(response.startswith("HTTP/1.0 200"))
        expected = {**LOCAL, "webhook": WEBHOOK}
        deploy.assert_called_once_with(expected, enable=True)
        github.api.assert_called_once_with(
            "POST", "/repos/" + LOCAL["repository"] + "/actions/workflows/daily-description-report.yml/dispatches",
            {"ref": "main", "inputs": {"mode": "deliver"}})
        self.assertEqual(status["stage"], "enabled")
        self.assertTrue(status["workflowDispatched"])
        self.assert_credentials_hidden(response + output + json.dumps(status))
        self.assertNotIn("delivered", response + output + json.dumps(status))

    def test_loopback_and_csrf_guards_reject_without_deploying(self):
        cases = [
            {"origin": "https://example.invalid"},
            {"host": "example.invalid:8765"},
            {"route": "/setup/wrong-session"},
            {"fields": {"nonce": "wrong-nonce", "webhook": WEBHOOK}},
        ]
        for case in cases:
            with self.subTest(case=case):
                response, _, deploy, github, _ = self.request(**case)
                self.assertTrue(response.startswith(("HTTP/1.0 400", "HTTP/1.0 403")))
                deploy.assert_not_called()
                github.api.assert_not_called()

    def test_failed_deploy_does_not_reflect_credential_in_error(self):
        response, status, _, github, output = self.request(
            deploy_error=RuntimeError(" ".join((LOCAL["jiraEmail"], LOCAL["jiraToken"], WEBHOOK))))
        self.assertTrue(response.startswith("HTTP/1.0 400"))
        self.assertEqual(status["stage"], "failed")
        self.assert_credentials_hidden(response + output + json.dumps(status))
        github.api.assert_not_called()

    def test_dispatch_failure_preserves_honest_enabled_status(self):
        response, status, deploy, _, output = self.request(dispatch_error=RuntimeError("dispatch failed"))
        self.assertTrue(response.startswith("HTTP/1.0 400"))
        deploy.assert_called_once()
        self.assertEqual(status["stage"], "dispatch-failed")
        self.assertTrue(status["deliveryEnabled"])
        self.assertFalse(status["workflowDispatched"])
        self.assertNotIn('"setupCompleted": true', output)
        self.assert_credentials_hidden(response + output + json.dumps(status))


if __name__ == "__main__":
    unittest.main()
