"""Изолированный API HomeCRM на официальном Python API Hermes v2026.6.5.

OAuth обслуживает Hermes. Здесь нет чтения auth.json или вызовов внутренних API ChatGPT.
"""
import base64
import contextlib
import hmac
import http.server
import json
import logging
import multiprocessing
import os
from pathlib import Path
import sys
import threading

MAX_BYTES = 15 * 1024 * 1024
HERMES_REVISION = "d6b9cfa3e1f460f5729553ef42b174da28b765c7"
logging.disable(logging.CRITICAL)


def complete(body, factory=None):
    if set(body) - {"model", "messages", "response_format", "stream"} or body.get("stream"):
        raise ValueError("invalid request")
    if body.get("model", "hermes-agent") != "hermes-agent":
        raise ValueError("invalid model")
    messages = body.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 10:
        raise ValueError("invalid messages")
    system = []
    history = []
    for message in messages:
        if set(message) != {"role", "content"}:
            raise ValueError("invalid message")
        role, content = message["role"], message["content"]
        if role == "system" and isinstance(content, str):
            system.append(content)
            continue
        if role != "user":
            raise ValueError("invalid role")
        if isinstance(content, list):
            for item in content:
                if item.get("type") == "text" and set(item) == {"type", "text"} and isinstance(item["text"], str):
                    continue
                if item.get("type") != "image_url" or set(item) != {"type", "image_url"}:
                    raise ValueError("invalid content")
                image = item["image_url"]
                if not isinstance(image, dict) or set(image) != {"url"} or not isinstance(image["url"], str) or not image["url"].startswith("data:image/jpeg;base64,"):
                    raise ValueError("invalid image")
                base64.b64decode(image["url"].split(",", 1)[1], validate=True)
        elif not isinstance(content, str):
            raise ValueError("invalid content")
        history.append({"role": "user", "content": content})
    if not history:
        raise ValueError("missing user")
    # Ни содержимое, ни исключения Hermes не попадают в stdout/stderr.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        if factory is None:
            from run_agent import AIAgent
            factory = AIAgent
        agent = factory(model=os.environ.get("HOMECRM_HERMES_MODEL", "gpt-5.4"), provider="openai-codex", enabled_toolsets=[],
                        skip_memory=True, skip_context_files=True,
                        save_trajectories=False, verbose_logging=False,
                        quiet_mode=True, session_db=None, max_iterations=1)
        # Отказ до передачи содержимого, если версия Hermes нарушила изоляцию.
        if agent.tools or agent._session_db is not None:
            raise RuntimeError("unsafe Hermes runtime")
        result = agent.run_conversation(
            user_message="Верни JSON черновика из переданных данных.",
            system_message="\n".join(system), conversation_history=history)
        response = result.get("final_response")
        if not isinstance(response, str):
            raise RuntimeError("invalid response")
        return {"choices": [{"message": {"role": "assistant", "content": response}}]}


def _worker(body, connection):
    try:
        connection.send((True, complete(body)))
    except Exception:
        connection.send((False, None))
    finally:
        connection.close()


def bounded_complete(body):
    # Отдельный процесс гарантирует остановку модели через 90 секунд, без файлов с содержимым.
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=_worker, args=(body, send), daemon=True)
    try:
        process.start()
        send.close()
        if not receive.poll(90):
            raise RuntimeError("timeout")
        ok, response = receive.recv()
        if not ok:
            raise RuntimeError("provider unavailable")
        return response
    finally:
        receive.close()
        send.close()
        if process.pid:
            process.join(1)
            if process.is_alive():
                process.terminate()
                process.join()


def make_server(port, key, factory=None):
    if not key or port == 8642:
        raise ValueError("invalid service configuration")
    gate = threading.BoundedSemaphore(1)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body):
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            self.close_connection = True

        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"code": "NOT_FOUND"})
            # Только признак наличия входа; значения читает исключительно Hermes.
            auth_present = (Path(os.environ["HERMES_HOME"]) / "auth.json").is_file()
            return self.reply(200, {"ok": True, "authPresent": auth_present})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                return self.reply(404, {"code": "NOT_FOUND"})
            authorization = self.headers.get("Authorization", "").encode("utf-8")
            if not hmac.compare_digest(authorization, ("Bearer " + key).encode("utf-8")):
                return self.reply(401, {"code": "UNAUTHORIZED"})
            if self.headers.get("Origin") or self.headers.get("Transfer-Encoding"):
                return self.reply(400, {"code": "INVALID_INPUT"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BYTES:
                    return self.reply(413, {"code": "TOO_LARGE"})
                if self.headers.get_content_type() != "application/json":
                    return self.reply(415, {"code": "INVALID_INPUT"})
                if not gate.acquire(blocking=False):
                    return self.reply(429, {"code": "BUSY"})
                try:
                    self.connection.settimeout(90)
                    raw = self.rfile.read(size)
                    if len(raw) != size:
                        raise ValueError("incomplete request")
                    body = json.loads(raw)
                    if not isinstance(body, dict):
                        raise ValueError("invalid request")
                    response = complete(body, factory) if factory else bounded_complete(body)
                finally:
                    gate.release()
            except (ValueError, TypeError, KeyError):
                return self.reply(400, {"code": "INVALID_INPUT"})
            except Exception:
                return self.reply(503, {"code": "AI_UNAVAILABLE"})
            return self.reply(200, response)

    return http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    # Ключ API-сервиса — отдельный секрет HomeCRM. OAuth-токены здесь не читаются.
    key = os.environ.pop("API_SERVER_KEY").strip()
    port = int(os.environ.get("HOMECRM_AI_PORT", "8643"))
    runtime = Path(os.environ["HOMECRM_HERMES_RUNTIME"]).resolve()
    sys.path.insert(0, str(runtime))
    os.chdir(os.environ["HERMES_HOME"])
    make_server(port, key).serve_forever()
