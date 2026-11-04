"""Prove dell'interfaccia nel browser: si eseguono solo se sono installati Node.js e Playwright.

Per installarli una volta (sul PC di sviluppo): `npm install -g playwright` e `npx playwright install chromium`.
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

from server import app

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tests" / "ui" / "smoke.cjs"


def _node_env():
    node = shutil.which("node")
    if not node:
        return None, None
    env = dict(os.environ)
    npm = shutil.which("npm")
    if npm:
        try:
            root = subprocess.run([npm, "root", "-g"], capture_output=True, text=True, timeout=30).stdout.strip()
            env["NODE_PATH"] = os.pathsep.join(x for x in (env.get("NODE_PATH"), root) if x)
        except (OSError, subprocess.SubprocessError):
            pass
    ok = subprocess.run([node, "-e", "require('playwright')"], env=env, capture_output=True, timeout=30).returncode == 0
    return (node, env) if ok else (None, None)


NODE, ENV = _node_env()


@unittest.skipUnless(NODE, "Node.js con Playwright non disponibile")
class UiSmoke(unittest.TestCase):
    def test_interfaccia(self):
        tmp = Path(tempfile.mkdtemp())
        cfg = app.Config(tmp / "data" / "plancia.db", ROOT / "web", port=0)
        server = app.make_server(cfg)
        cfg.port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            run = subprocess.run([NODE, str(SCRIPT), f"http://127.0.0.1:{cfg.port}"], env=ENV, capture_output=True, text=True, timeout=300)
        finally:
            server.shutdown()
            server.server_close()
            shutil.rmtree(tmp, ignore_errors=True)
        lines = [ln for ln in run.stdout.splitlines() if ln.startswith("[")]
        self.assertTrue(lines, f"nessun risultato dalle prove:\n{run.stdout}\n{run.stderr}")
        failed = [f"{r['name']}: {r.get('error')}" for r in json.loads(lines[-1]) if not r["ok"]]
        self.assertFalse(failed, "Prove dell'interfaccia non riuscite:\n" + "\n".join(failed))


if __name__ == "__main__":
    unittest.main()
