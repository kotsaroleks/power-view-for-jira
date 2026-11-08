#!/usr/bin/env python3
"""One-time, loopback-only setup. Open the printed link manually; no desktop control.

Credentials are verified in memory and uploaded as encrypted GitHub Actions secrets.
They are never written to the page, logs, repository files or local setup JSON.
"""
import argparse
import base64
import hashlib
from html import escape
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import os
from pathlib import Path
import secrets
from datetime import datetime, timezone
import time
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent.parent
STYLE = """*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#172b4d;font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:720px;margin:40px auto;padding:32px;background:white;border:1px solid #dfe4ed;border-radius:18px;box-shadow:0 8px 32px #172b4d0b}h1{margin:0 0 12px;font-size:28px;line-height:1.2}p{margin:16px 0;color:#465570}strong,label{color:#172b4d}label{display:block;font-weight:600}input:not([type=hidden]){width:100%;padding:12px 14px;margin-top:6px;border:1px solid #c7d0df;border-radius:8px;font:inherit;background:#fff;color:#172b4d}input:focus{outline:3px solid #bad6ff;border-color:#0969da}a{color:#075fce}details{padding:12px 16px;background:#f5f8fe;border-radius:8px;font-size:14px}summary{cursor:pointer;font-weight:600}button{width:100%;padding:14px 18px;border:0;border-radius:9px;background:#0969da;color:white;font:600 16px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}button:hover{background:#0758b8}[role=alert]{padding:12px;background:#fff2f2;color:#ae2e24;border-radius:8px}@media(max-width:760px){main{margin:16px;padding:24px}}"""
STYLE_HASH = base64.b64encode(hashlib.sha256(STYLE.encode()).digest()).decode()
spec = importlib.util.spec_from_file_location("report_setup", ROOT / "scripts/configure-description-report.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def document(body):
    return ("<!doctype html><html lang='uk'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
            "<title>Репорти Power View</title><style>" + STYLE + "</style><body><main>" + body + "</main></body></html>")


def form(local, action, nonce, error=""):
    saved_jira = bool(local.get("jiraEmail") and local.get("jiraToken"))
    jira_fields = ("<p><strong>Jira: збережений вхід знайдено.</strong> Повторно вводити ключ не потрібно.</p>" if saved_jira else
        "<p>Збережений вхід Jira недоступний. Вкажіть email і ключ API Jira для підключення.</p>")
    manual_jira = "" if saved_jira else (
        "<p><label>Email Jira<br><input type='email' name='email' required autocomplete='username' value='" + escape(local.get("jiraEmail", "")) + "'></label></p>"
        "<p><label>Ключ API Jira<br><input type='password' name='jiraToken' required autocomplete='off'></label></p>")
    return document("<h1>Підключення щоденних репортів</h1>"
        "<p>О 21:00 за Києвом перевірятимемо зміни описів задач. Репорт потрапить у вибрану вами групу Google Chat, якщо були зміни.</p>"
        "<p><strong>Дошка:</strong> " + escape(local["config"]["boardId"]) + " · " + escape(local["config"]["jiraBaseUrl"]) + "</p>"
        + jira_fields +
        "<h2>Підключення Google Chat</h2>"
        "<p>Вставте webhook вибраної групи. Окремий вхід у Google не потрібен.</p>"
        + ("<p role='alert'>" + escape(error) + "</p>" if error else "") +
        "<form method='post' action='" + escape(action) + "'>"
        "<input type='hidden' name='nonce' value='" + nonce + "'>"
        + manual_jira +
        "<p><label>Адреса надсилання Google Chat (webhook)<br><input type='password' name='webhook' required autocomplete='off'></label></p>"
        "<details><summary>Де взяти адресу Google Chat</summary><p>Відкрийте групу → натисніть її назву → Apps &amp; integrations → Add webhooks. Назвіть його Power View, збережіть і скопіюйте посилання. Якщо кнопки немає, додавання вебхуків обмежене адміністратором групи.</p></details>"
        "<p>Ця сторінка працює лише на вашому Mac. Ключі будуть перевірені та збережені в захищених налаштуваннях приватного репозиторію GitHub.</p>"
        "<button type='submit'>Перевірити та увімкнути репорти</button>"
        "<p>Перевірка історії Jira може тривати кілька хвилин. Після неї запускається перший належний репорт; порожні повідомлення не надсилаються.</p></form>")


def serve(local, lifetime=86400, ready_path=None, session=None, status_path=None, on_ready=None):
    nonce = session["nonce"] if session else secrets.token_urlsafe(32)
    route = session["route"] if session else "/setup/" + secrets.token_urlsafe(24)
    port = session["port"] if session else 0
    if not route.startswith("/setup/") or len(nonce) < 24 or not isinstance(port, int) or not 0 <= port <= 65535:
        raise RuntimeError("Invalid protected setup session.")
    deadline = time.monotonic() + lifetime

    def status(stage, **fields):
        if status_path:
            descriptor = os.open(status_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w") as file:
                json.dump({"stage": stage, "updatedAt": datetime.now(timezone.utc).isoformat(), **fields}, file)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, body):
            raw = body.encode()
            self.send_response(status)
            for name, value in {"Content-Type": "text/html; charset=utf-8", "Content-Length": str(len(raw)),
                                "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                                "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                                "Content-Security-Policy": "default-src 'none'; style-src 'sha256-" + STYLE_HASH + "'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            return self.path == route and self.headers.get("Host") == self.server.address

        def do_GET(self):
            if not self.allowed():
                self.respond(404, document("<p>Сторінка недоступна.</p>"))
                return
            self.respond(200, form(local, route, nonce))

        def do_POST(self):
            if (not self.allowed() or self.headers.get("Origin") != "http://" + self.server.address
                    or self.headers.get("Content-Type", "").split(";")[0] != "application/x-www-form-urlencoded"):
                self.respond(403, document("<p>Відкрийте локальне посилання налаштування.</p>"))
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    raise ValueError()
                fields = parse_qs(self.rfile.read(length).decode(), strict_parsing=True)
                if fields.get("nonce") != [nonce]:
                    raise ValueError()
                if any(len(fields.get(key, [])) > 1 for key in ("email", "jiraToken", "webhook")):
                    raise ValueError()
                values = {key: fields.get(key, [""])[0].strip() for key in ("email", "jiraToken", "webhook")}
                values["email"] = values["email"] or local.get("jiraEmail", "")
                values["jiraToken"] = values["jiraToken"] or local.get("jiraToken", "")
                if not all(values.values()):
                    raise ValueError()
            except (ValueError, UnicodeError, KeyError):
                status("incomplete-settings")
                self.respond(400, form(local, route, nonce, "Підключення ще не завершене. Збережений ключ Jira використовується автоматично, якщо він доступний."))
                return
            try:
                status("verifying")
                configured = {**local, "config": dict(local["config"]), "jiraEmail": values["email"], "jiraToken": values["jiraToken"], "webhook": values["webhook"]}
                result = setup.deploy(configured, enable=True)
            except Exception as error:
                status("failed", errorType=type(error).__name__)
                self.respond(400, form(local, route, nonce, "Не вдалося завершити перевірку та налаштування. Спробуйте ще раз."))
                return
            try:
                setup.GitHub().api("POST", "/repos/" + local["repository"] + "/actions/workflows/daily-description-report.yml/dispatches", {"ref": "main", "inputs": {"mode": "deliver"}})
            except Exception as error:
                status("dispatch-failed", deliveryEnabled=True, workflowDispatched=False, errorType=type(error).__name__)
                self.respond(400, document("<h1>Розклад увімкнено, перший запуск не підтверджено</h1><p>Jira перевірена, налаштування збережені. Не вдалося підтвердити запуск першого репорту в GitHub. Заплановані запуски залишаються увімкненими.</p><p>Перевірте <a href='" + escape(result["repository"] + "/actions") + "'>історію запусків</a> перед повторним запуском. Надсилання в чат ще не підтверджено.</p>"))
                return
            status("enabled", deliveryEnabled=True, workflowDispatched=True)
            self.respond(200, document("<h1>Репорти увімкнено</h1><p>Jira перевірена. Перший запуск передано GitHub; наступні заплановані о 21:00 за Києвом.</p><p>Факт надсилання перевіряйте в <a href='" + escape(result["repository"] + "/actions") + "'>історії запусків</a>. Якщо змін немає, бот надсилає «No changes for today».</p><p>Цю сторінку можна закрити.</p>"))
            print(json.dumps({"setupCompleted": True, "deliveryEnabled": True, "workflowDispatched": True}), flush=True)
            self.server.done = True

    with HTTPServer(("127.0.0.1", port), Handler) as server:
        if on_ready:
            on_ready()
        server.address = "127.0.0.1:" + str(server.server_port)
        server.done = False
        server.timeout = 1
        url = "http://" + server.address + route
        if ready_path:
            descriptor = os.open(ready_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w") as file:
                file.write(url + "\n")
        print(json.dumps({"setupUrl": url, "expiresInSeconds": lifetime}), flush=True)
        status("awaiting-chat", savedJiraAvailable=bool(local.get("jiraEmail") and local.get("jiraToken")))
        while not server.done and time.monotonic() < deadline:
            server.handle_request()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(ROOT / ".secrets/description-report.local.json"))
    parser.add_argument("--ready-path")
    parser.add_argument("--session", help="Protected session metadata for resuming the existing local page.")
    parser.add_argument("--jira-credential-file", help="Protected one-time credential transfer; never rendered in HTML.")
    parser.add_argument("--status-path")
    parser.add_argument("--lifetime", type=int, default=86400)
    args = parser.parse_args()
    path = Path(args.config)
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise SystemExit("The protected local setup file is missing or not private.")
    local = json.loads(path.read_text())
    cleanup = None
    if args.jira_credential_file:
        credential_path = Path(args.jira_credential_file)
        if credential_path.stat().st_mode & 0o077:
            raise SystemExit("The one-time credential transfer is not private.")
        credential = json.loads(credential_path.read_text())
        if credential["origin"].rstrip("/") != local["config"]["jiraBaseUrl"].rstrip("/"):
            raise SystemExit("The saved Jira site does not match this report.")
        local.update(jiraEmail=credential["email"], jiraToken=credential["token"])
        cleanup = credential_path.unlink
    else:
        local = setup.resolve_jira_credential(local)
    session = None
    if args.session:
        session_path = Path(args.session)
        if session_path.stat().st_mode & 0o077:
            raise SystemExit("The resumed setup session is not private.")
        session = json.loads(session_path.read_text())
    serve(local, lifetime=args.lifetime, ready_path=args.ready_path, session=session, status_path=args.status_path, on_ready=cleanup)
