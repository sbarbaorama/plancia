import http.client
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from server import app


class ServerCase(unittest.TestCase):
    team = False

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        cfg = app.Config(self.dir / "data" / "plancia.db", Path(__file__).resolve().parent.parent / "web", team=self.team, port=0)
        self.server = app.make_server(cfg)
        cfg.port = self.server.server_address[1]
        self.port = cfg.port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.cookie = None

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def req(self, method, path, body=None, headers=None, raw=None, ctype="application/json"):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}", "X-Plancia": "1"}
        if self.cookie:
            h["Cookie"] = self.cookie
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            h["Content-Type"] = ctype
        h.update(headers or {})
        h = {k: v for k, v in h.items() if v is not None}
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        payload = r.read()
        sc = r.getheader("Set-Cookie")
        if sc:
            self.cookie = sc.split(";")[0]
        c.close()
        try:
            return r.status, json.loads(payload) if payload else None
        except ValueError:
            return r.status, payload


class PersonalTest(ServerCase):
    def test_crud_flow(self):
        s, cu = self.req("POST", "/api/customers", {"name": "Acme", "code": "ACM"})
        self.assertEqual(s, 201)
        s, t = self.req("POST", "/api/tasks", {"title": "Prova", "customer_id": cu["id"]})
        self.assertEqual((s, t["customer_code"]), (201, "ACM"))
        s, t = self.req("PUT", f"/api/tasks/{t['id']}", {"status": "chiuso"})
        self.assertEqual(t["status"], "chiuso")
        s, d = self.req("GET", "/api/dashboard")
        self.assertEqual(s, 200)
        s, ck = self.req("GET", f"/api/customers/{cu['id']}/cockpit")
        self.assertEqual(s, 200)
        s, _ = self.req("DELETE", f"/api/tasks/{t['id']}")
        self.assertEqual(s, 204)
        s, err = self.req("POST", "/api/tasks", {"title": ""})
        self.assertEqual(s, 400)
        self.assertIn("obbligatorio", err["error"])
        s, _ = self.req("GET", "/api/users/1")
        self.assertEqual(s, 404)

    def test_security(self):
        s, _ = self.req("POST", "/api/tasks", {"title": "x"}, headers={"X-Plancia": None})
        self.assertEqual(s, 403)
        s, _ = self.req("POST", "/api/tasks", {"title": "x"}, headers={"Origin": "http://evil.example"})
        self.assertEqual(s, 403)
        s, _ = self.req("GET", "/api/tasks", headers={"Host": "evil.example"})
        self.assertEqual(s, 403)
        s, _ = self.req("POST", "/api/tasks", raw=b"title=x", ctype="application/x-www-form-urlencoded")
        self.assertEqual(s, 415)
        s, ok = self.req("POST", "/api/tasks", {"title": "x"}, headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(s, 201)
        s, _ = self.req("GET", "/../server/app.py")
        self.assertEqual(s, 404)

    def test_upload(self):
        _, t = self.req("POST", "/api/tasks", {"title": "Con file"})
        s, att = self.req("POST", f"/api/attachments/upload?entity_type=tasks&entity_id={t['id']}&name=note.txt",
                          raw=b"ciao", ctype="application/octet-stream")
        self.assertEqual(s, 201)
        s, body = self.req("GET", f"/api/attachments/{att['id']}/file")
        self.assertEqual((s, body), (200, b"ciao"))
        s, _ = self.req("POST", f"/api/attachments/upload?entity_type=tasks&entity_id={t['id']}&name=x.exe",
                        raw=b"MZ", ctype="application/octet-stream")
        self.assertEqual(s, 400)

    def test_static(self):
        s, body = self.req("GET", "/")
        self.assertEqual(s, 200)
        self.assertIn(b"Plancia", body)


class TeamHttpTest(ServerCase):
    team = True

    def test_login_flow(self):
        s, sess = self.req("GET", "/api/session")
        self.assertTrue(sess["needs_setup"])
        s, _ = self.req("GET", "/api/tasks")
        self.assertEqual(s, 401)
        s, _ = self.req("POST", "/api/auth/setup", {"name": "Anna", "username": "anna", "password": "corta"})
        self.assertEqual(s, 400)
        s, _ = self.req("POST", "/api/auth/setup", {"name": "Anna", "username": "anna", "password": "password-lunga-1"})
        self.assertEqual(s, 200)
        s, _ = self.req("GET", "/api/tasks")
        self.assertEqual(s, 200)
        s, u = self.req("POST", "/api/users", {"name": "Bruno", "username": "bruno", "password": "password-lunga-2"})
        self.assertEqual(s, 201)
        self.req("POST", "/api/auth/logout")
        s, _ = self.req("GET", "/api/tasks")
        self.assertEqual(s, 401)
        s, _ = self.req("POST", "/api/auth/login", {"username": "bruno", "password": "password-lunga-2"})
        self.assertEqual(s, 200)
        s, _ = self.req("PUT", "/api/settings", {"theme": "scuro"})
        self.assertEqual(s, 403)
        s, sess = self.req("GET", "/api/session")
        self.assertEqual(sess["user"]["username"], "bruno")


if __name__ == "__main__":
    unittest.main()
