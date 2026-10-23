"""Тесты без OAuth и без сетевого провайдера; только временный HERMES_HOME."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import socket
import sys
import time
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("homecrm_hermes", Path(__file__).with_name("server.py"))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class Agent:
    def __init__(self, **kwargs):
        assert kwargs["provider"] == "openai-codex"
        assert kwargs["enabled_toolsets"] == [] and kwargs["skip_memory"]
        assert kwargs["skip_context_files"] and not kwargs["save_trajectories"]
        assert kwargs["session_db"] is None
        self.tools = []
        self._session_db = None
    def run_conversation(self, **kwargs):
        return {"final_response": "fictional-response-marker"}

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="homecrm-hermes-test-")
        self.previous = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = self.temp.name
        self.server = service.make_server(0, "fictional-test-service-key", Agent)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        if self.previous is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self.previous
        self.temp.cleanup()
    def send(self, body, key="fictional-test-service-key", **headers):
        request = urllib.request.Request(self.url+"/v1/chat/completions", json.dumps(body).encode(), {"Authorization": "Bearer "+key, "Content-Type":"application/json", **headers})
        # Локальная проверка не использует пользовательский прокси.
        return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request)
    def test_privacy_and_image(self):
        body={"model":"hermes-agent", "messages":[{"role":"user","content":[{"type":"text","text":"fictional-request-marker"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,YQ=="}}]}]}
        with self.send(body) as response:
            self.assertEqual(response.status,200)
            self.assertNotIn("Access-Control-Allow-Origin",response.headers)
        for path in Path(self.temp.name).rglob("*"):
            if path.is_file():
                data=path.read_bytes()
                self.assertFalse(b"fictional-request-marker" in data or b"fictional-response-marker" in data)
    def test_auth_and_origin(self):
        for headers in [{"key":"wrong"},{"Origin":"https://example.test"}]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.send({},**headers)
            self.assertIn(caught.exception.code,[400,401])
            caught.exception.close()
    def test_size(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.send({}, **{"Content-Length":str(service.MAX_BYTES+1)})
        self.assertEqual(caught.exception.code,413)
        caught.exception.close()
    def test_health_and_missing_routes(self):
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(self.url+"/health") as response:
            self.assertFalse(json.load(response)["authPresent"])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            opener.open(self.url+"/v1/models")
        caught.exception.close()
class ProcessTests(unittest.TestCase):
    def test_real_http_process_does_not_persist_content(self):
        # Проверяет настоящий путь spawn/HTTP без OAuth: подменён только официальный AIAgent.
        with tempfile.TemporaryDirectory(prefix="homecrm-hermes-process-") as folder:
            root = Path(folder)
            home = root / "home"; home.mkdir()
            runtime = root / "runtime"; runtime.mkdir()
            (runtime / "run_agent.py").write_text(
                "class AIAgent:\n"
                " def __init__(self, **kw):\n"
                "  assert kw['provider']=='openai-codex' and kw['enabled_toolsets']==[]\n"
                "  assert kw['skip_memory'] and kw['skip_context_files'] and not kw['save_trajectories']\n"
                "  self.tools=[]; self._session_db=None\n"
                " def run_conversation(self, **kw):\n"
                "  return {'final_response': kw['conversation_history'][0]['content']}\n",
                encoding="utf-8")
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
            env = {**os.environ, "HERMES_HOME":str(home), "HOMECRM_HERMES_RUNTIME":str(runtime),
                   "HOMECRM_AI_PORT":str(port), "API_SERVER_KEY":"fictional-test-service-key", "PYTHONDONTWRITEBYTECODE":"1"}
            process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("server.py"))], env=env,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            url="http://127.0.0.1:"+str(port)
            try:
                for _ in range(100):
                    try:
                        with opener.open(url+"/health", timeout=1):
                            break
                    except urllib.error.URLError:
                        time.sleep(0.05)
                body={"model":"hermes-agent","messages":[{"role":"user","content":"private-fictional-process-marker"}]}
                request=urllib.request.Request(url+"/v1/chat/completions",json.dumps(body).encode(),
                    {"Content-Type":"application/json","Authorization":"Bearer fictional-test-service-key"})
                with opener.open(request, timeout=10) as response:
                    self.assertEqual(response.status,200)
                    self.assertEqual(json.load(response)["choices"][0]["message"]["content"], body["messages"][0]["content"])
                for path in home.rglob("*"):
                    if path.is_file():
                        self.assertNotIn(b"private-fictional-process-marker",path.read_bytes())
            finally:
                process.terminate()
                out,err=process.communicate(timeout=10)
                self.assertNotIn(b"private-fictional-process-marker",out+err)

if __name__ == "__main__":
    unittest.main()
