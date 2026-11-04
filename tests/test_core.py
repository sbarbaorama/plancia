import json
import shutil
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from server import auth, backup, crud, legacy, ops
from server.crud import Ctx, Forbidden, NotFound, ValidationError
from server.db import open_db, _statements

TODAY = date.today()


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.conn = open_db(self.dir / "data" / "plancia.db")
        auth.ensure_local_user(self.conn)

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def mk(self, res, **data):
        return crud.create_item(self.conn, res, data)


class CrudTest(Base):
    def test_customer_task_and_inherited_customer(self):
        cu = self.mk("customers", name="Ferretti Logistica", code="FRL")
        p = self.mk("projects", name="Monitoraggio", customer_id=cu["id"])
        t1 = self.mk("tasks", title="Task di progetto", project_id=p["id"])
        t2 = self.mk("tasks", title="Task senza progetto", customer_id=cu["id"])
        self.mk("tasks", title="Altro")
        self.assertEqual(t1["customer_code"], "FRL")
        ids = {t["id"] for t in crud.list_items(self.conn, "tasks", {"customer_id": cu["id"]})}
        self.assertEqual(ids, {t1["id"], t2["id"]})
        self.assertEqual(crud.get_item(self.conn, "customers", cu["id"])["open_tasks"], 2)

    def test_validation(self):
        with self.assertRaises(ValidationError):
            self.mk("tasks", title="")
        with self.assertRaises(ValidationError):
            self.mk("tasks", title="x", priority="urgentissima")
        with self.assertRaises(ValidationError):
            self.mk("tasks", title="x", start_date="2026-12-10", due_date="2026-12-01")
        self.mk("customers", name="Acme")
        with self.assertRaises(ValidationError):
            self.mk("customers", name="ACME")

    def test_close_sets_closed_at_and_log(self):
        t = self.mk("tasks", title="Chiudimi")
        t = crud.update_item(self.conn, "tasks", t["id"], {"status": "chiuso"})
        self.assertTrue(t["closed_at"])
        hist = ops.task_history(self.conn, t["id"])
        self.assertEqual(hist[0]["action"], "chiuso")
        self.assertIn("Stato", hist[0]["detail"])

    def test_recurring_task(self):
        t = self.mk("tasks", title="Report mensile", due_date="2026-01-31", recurrence_unit="mesi", recurrence_every=1)
        ops.set_subtasks(self.conn, t["id"], [{"title": "Estrarre dati", "done": True}])
        crud.update_item(self.conn, "tasks", t["id"], {"status": "chiuso"})
        nxt = crud.list_items(self.conn, "tasks", {"open": "1"})
        self.assertEqual(len(nxt), 1)
        self.assertEqual(nxt[0]["due_date"], "2026-02-28")
        self.assertEqual(nxt[0]["recurrence_unit"], "mesi")
        self.assertEqual(ops.list_subtasks(self.conn, nxt[0]["id"])[0]["done"], 0)
        self.assertEqual(crud.get_item(self.conn, "tasks", t["id"])["recurrence_unit"], "nessuna")

    def test_recurring_needs_date(self):
        with self.assertRaises(ValidationError):
            self.mk("tasks", title="x", recurrence_unit="settimane")

    def test_contact_service_manager(self):
        a = self.mk("customers", name="A")
        b = self.mk("customers", name="B")
        c = crud.create_item(self.conn, "contacts", {"name": "Sara", "is_service_manager": True, "sm_customer_ids": [a["id"], b["id"]]})
        self.assertEqual(len(c["sm_customers"]), 2)
        self.assertEqual(crud.get_item(self.conn, "customers", a["id"])["service_managers"][0]["name"], "Sara")
        c = crud.update_item(self.conn, "contacts", c["id"], {"is_service_manager": False})
        self.assertEqual(c["sm_customers"], [])

    def test_contact_first_last_name_and_companies(self):
        c = crud.create_item(self.conn, "contacts", {"first_name": "Mario", "last_name": "Rossi", "company": "Acme Srl"})
        self.assertEqual(c["name"], "Mario Rossi")
        self.assertEqual([x["name"] for x in crud.list_items(self.conn, "companies")], ["Acme Srl"])
        c = crud.update_item(self.conn, "contacts", c["id"], {"last_name": "Bianchi", "company": "acme srl"})
        self.assertEqual(c["name"], "Mario Bianchi")
        self.assertEqual(len(crud.list_items(self.conn, "companies")), 1)  # stessa azienda, maiuscole diverse
        # solo il nome completo (versioni precedenti, importazioni): si divide
        d = crud.create_item(self.conn, "contacts", {"name": "Anna Maria Verdi"})
        self.assertEqual((d["first_name"], d["last_name"]), ("Anna", "Maria Verdi"))
        crud.create_item(self.conn, "contacts", {"first_name": "Zeno", "last_name": "Abate"})
        self.assertEqual([x["last_name"] for x in crud.list_items(self.conn, "contacts")], ["Abate", "Bianchi", "Maria Verdi"])
        with self.assertRaises(crud.ValidationError):
            crud.create_item(self.conn, "contacts", {"first_name": " ", "last_name": ""})
        with self.assertRaises(crud.ValidationError):
            crud.create_item(self.conn, "companies", {"name": "ACME SRL"})

    def test_company_rename_merge_delete(self):
        a = crud.create_item(self.conn, "companies", {"name": "Acme"})
        b = crud.create_item(self.conn, "companies", {"name": "Acme Srl"})
        c = crud.create_item(self.conn, "contacts", {"first_name": "Mario", "last_name": "Rossi", "company": "Acme"})
        crud.update_item(self.conn, "companies", a["id"], {"name": "ACME Spa"})
        self.assertEqual(crud.get_item(self.conn, "contacts", c["id"])["company"], "ACME Spa")
        with self.assertRaises(crud.ValidationError):  # usata da un contatto
            crud.delete_item(self.conn, "companies", a["id"])
        merged = crud.merge_companies(self.conn, a["id"], b["id"])
        self.assertEqual(merged["contacts_count"], 1)
        self.assertEqual(crud.get_item(self.conn, "contacts", c["id"])["company"], "Acme Srl")
        self.assertEqual([x["name"] for x in crud.list_items(self.conn, "companies")], ["Acme Srl"])

    def test_vcard_roundtrip(self):
        from server import rubrica
        crud.create_item(self.conn, "contacts", {"first_name": "Anna", "last_name": "D'Amico", "company": "Beta, Srl",
                                                 "email": "anna@beta.it", "phone": "+39 0461 123456", "notes": "riga 1\nriga 2"})
        vcf = rubrica.export_vcf(self.conn)
        self.assertIn("ORG:Beta\\, Srl", vcf)
        people = rubrica.parse_vcf(vcf)
        self.assertEqual(people[0]["company"], "Beta, Srl")
        self.assertEqual(people[0]["notes"], "riga 1\nriga 2")
        outlook = "BEGIN:VCARD\r\nVERSION:2.1\r\nN;LANGUAGE=it:Verdi;Luca\r\nFN:Luca Verdi\r\nORG:Gamma\r\n" \
                  "TEL;HOME;VOICE:011 1\r\nTEL;CELL;VOICE:333 2\r\nEMAIL;PREF;INTERNET:luca@gamma.it\r\nEND:VCARD\r\n"
        r = rubrica.import_vcf(self.conn, vcf + outlook)
        self.assertEqual(r["created"], 1)
        self.assertEqual(r["skipped"], ["Anna D'Amico"])
        luca = crud.list_items(self.conn, "contacts", {"q": "Verdi"})[0]
        self.assertEqual((luca["first_name"], luca["company"], luca["phone"]), ("Luca", "Gamma", "333 2"))
        csv_text = rubrica.export_csv(self.conn)
        self.assertTrue(csv_text.startswith("\ufeffCognome;Nome"))

    def test_event_end_defaults_and_range(self):
        e = self.mk("events", title="Call", start=f"{TODAY.isoformat()}T10:00")
        self.assertEqual(e["end"], e["start"])
        got = crud.list_items(self.conn, "events", {"from": TODAY.isoformat(), "to": TODAY.isoformat()})
        self.assertEqual([x["id"] for x in got], [e["id"]])


class OpsTest(Base):
    def test_deadline_recurrence(self):
        d = self.mk("deadlines", title="Certificato", due_date="2026-03-01", recurrence_unit="anni", recurrence_every=1)
        r = ops.complete_deadline(self.conn, d["id"], date(2026, 2, 20))
        self.assertEqual(r["done"]["status"], "fatta")
        self.assertEqual(r["next"]["due_date"], "2027-02-20")

    def test_waiting_follow_up(self):
        w = self.mk("waiting_items", title="Ticket")
        self.assertEqual(w["requested_on"], TODAY.isoformat())
        w = ops.follow_up(self.conn, w["id"])
        self.assertEqual(w["follow_ups"], 1)
        self.assertGreater(w["follow_up_on"], TODAY.isoformat())
        w = crud.update_item(self.conn, "waiting_items", w["id"], {"status": "ricevuto"})
        self.assertTrue(w["closed_at"])

    def test_inbox_convert(self):
        n = self.mk("inbox_items", text="Chiamare fornitore\nper il ticket 42")
        r = ops.convert_inbox(self.conn, n["id"], "tasks")
        self.assertEqual(r["item"]["title"], "Chiamare fornitore")
        self.assertEqual(r["item"]["notes"], "per il ticket 42")
        with self.assertRaises(ValidationError):
            ops.convert_inbox(self.conn, n["id"], "tasks")

    def test_plan_and_close_day(self):
        a = self.mk("tasks", title="A", estimate_min=60)
        b = self.mk("tasks", title="B", estimate_min=30, due_date=(TODAY - timedelta(days=1)).isoformat())
        p = ops.plan_day(self.conn, TODAY)
        self.assertEqual([t["id"] for t in p["backlog"][0]["items"]], [b["id"]])
        p = ops.set_plan(self.conn, TODAY, [b["id"], a["id"]])
        self.assertEqual([t["id"] for t in p["plan"]], [b["id"], a["id"]])
        self.assertEqual(p["capacity"]["planned_min"], 90)
        self.assertEqual(p["backlog"][0]["items"], [])
        crud.update_item(self.conn, "tasks", b["id"], {"status": "chiuso"})
        r = ops.close_day(self.conn, TODAY)
        self.assertEqual((r["done"], r["moved"]), (1, 1))
        self.assertEqual(crud.get_item(self.conn, "tasks", a["id"])["planned_for"], r["next_day"])
        self.assertIn("Fatto:", r["text"])

    def test_timer(self):
        cu = self.mk("customers", name="C")
        t = self.mk("tasks", title="Lavoro", customer_id=cu["id"])
        ops.start_timer(self.conn, {"task_id": t["id"]})
        self.assertEqual(crud.get_item(self.conn, "tasks", t["id"])["status"], "in_corso")
        running = ops.running_timer(self.conn)
        self.assertEqual(running["customer_id"], cu["id"])
        e = ops.stop_timer(self.conn)
        self.assertGreaterEqual(e["minutes"], 1)
        self.assertIsNone(ops.running_timer(self.conn))
        self.mk("time_entries", date=TODAY.isoformat(), minutes=90, task_id=t["id"])
        s = ops.time_summary(self.conn, TODAY.replace(day=1), TODAY)
        self.assertEqual(s["by_customer"][0]["minutes"], 90 + e["minutes"])
        self.assertIn("Lavoro", ops.time_csv(self.conn, TODAY.replace(day=1), TODAY))

    def test_consultation_lifecycle(self):
        cu = self.mk("customers", name="Comune")
        co = self.mk("contacts", name="Luca", is_consultant=True)
        c = ops.create_consultation(self.conn, {"consultant_id": co["id"], "customer_id": cu["id"], "date_start": TODAY.isoformat(),
                                                "activities": [{"title": "Uno"}, {"title": "Due"}]})
        self.assertEqual((c["activities_total"], c["status"]), (2, "pianificata"))
        task = crud.get_item(self.conn, "tasks", c["task_id"])
        self.assertEqual((task["kind"], task["planned_for"]), ("consulenza", TODAY.isoformat()))
        acts = ops.list_subtasks(self.conn, c["task_id"])
        ops.set_subtasks(self.conn, c["task_id"], [{**acts[0], "done": True, "outcome": "ok"}, acts[1]])
        c2 = ops.duplicate_consultation(self.conn, c["id"])
        self.assertEqual(c2["activities_total"], 1)
        self.assertEqual(c2["date_start"], (TODAY + timedelta(days=7)).isoformat())
        c = ops.close_consultation(self.conn, c["id"], "Tutto fatto")
        self.assertEqual(c["status"], "chiusa")
        self.assertEqual(crud.get_item(self.conn, "tasks", c["task_id"])["status"], "chiuso")
        ops.delete_consultation(self.conn, c2["id"])
        with self.assertRaises(NotFound):
            crud.get_item(self.conn, "consultations", c2["id"])

    def test_meeting_actions_and_series(self):
        cu = self.mk("customers", name="Cli")
        m1 = self.mk("meetings", title="SAL 1", series="SAL", date="2026-10-01T10:00", customer_id=cu["id"])
        acts = ops.set_actions(self.conn, m1["id"], [{"title": "Inviare offerta"}, {"title": "Aprire ticket"}])
        self.assertEqual(len(acts), 2)
        self.assertEqual(acts[0]["eff_customer_id"], cu["id"])
        crud.update_item(self.conn, "tasks", acts[0]["id"], {"status": "chiuso"})
        m2 = self.mk("meetings", title="SAL 2", series="SAL", date="2026-10-08T10:00")
        carried = ops.carried_actions(self.conn, m2["id"])
        self.assertEqual([t["title"] for t in carried], ["Aprire ticket"])
        ops.set_actions(self.conn, m1["id"], [acts[0]])
        self.assertEqual(len(crud.list_items(self.conn, "tasks", {"meeting_id": m1["id"]})), 1)

    def test_freeze_and_calendar_and_cockpit(self):
        cu = self.mk("customers", name="Cli", code="CL", monthly_hours=40)
        self.mk("change_freezes", title="Chiusura contabile", customer_id=cu["id"], start_date=TODAY.isoformat(),
                end_date=(TODAY + timedelta(days=1)).isoformat())
        ch = self.mk("changes", title="Soglie", customer_id=cu["id"], planned_at=f"{TODAY.isoformat()}T16:30")
        self.assertEqual(len(ops.freeze_conflicts(self.conn, cu["id"], ch["planned_at"])), 1)
        self.assertEqual(ops.freeze_conflicts(self.conn, None, ch["planned_at"]), [])
        cal = ops.change_calendar(self.conn, TODAY, TODAY + timedelta(days=13), cu["id"])
        self.assertEqual(cal["changes"][0]["freezes"], ["Chiusura contabile"])
        crud.update_item(self.conn, "changes", ch["id"], {"outcome": "rollback"})
        self.mk("waiting_items", title="VPN", customer_id=cu["id"], follow_up_on=TODAY.isoformat())
        ck = ops.customer_cockpit(self.conn, cu["id"], TODAY)
        self.assertEqual(ck["kpi"]["changes_bad"], 1)
        self.assertEqual(ck["kpi"]["waits_due"], 1)
        self.assertTrue(any(f["resource"] == "changes" for f in ck["feed"]))
        rep = ops.weekly_report(self.conn, TODAY - timedelta(days=TODAY.weekday()), TODAY + timedelta(days=6), cu["id"])
        self.assertIn("Soglie", rep["text"])

    def test_dashboard_search_reminders(self):
        self.mk("tasks", title="Rinnovo certificato portale", due_date=(TODAY - timedelta(days=2)).isoformat())
        self.mk("deadlines", title="Licenza", due_date=(TODAY + timedelta(days=5)).isoformat(), notice_days=10)
        d = ops.dashboard(self.conn, TODAY)
        self.assertEqual(len(d["overdue"]), 1)
        self.assertEqual(len(d["deadlines_due"]), 1)
        self.assertIn("tasks", ops.search(self.conn, "CERTIFICATO"))
        keys = [r["key"] for r in ops.reminders(self.conn, __import__("datetime").datetime.now())]
        self.assertTrue(any(k.startswith("late-") for k in keys))

    def test_checklist(self):
        tpl = self.mk("checklist_templates", name="Upgrade", steps="Snapshot\nUpgrade\nVerifica")
        run = ops.start_checklist(self.conn, tpl["id"])
        for i in range(3):
            run = ops.set_checklist_step(self.conn, run["id"], i, True)
        self.assertTrue(run["completed_at"])


class TeamTest(Base):
    def test_visibility_and_permissions(self):
        auth.setup_admin(self.conn, "Anna", "anna", "password-lunga-1")
        ctx_b = Ctx(user_id=auth.create_user(self.conn, {"name": "Bruno", "username": "bruno", "password": "password-lunga-2"},
                                             Ctx(1, True, True))["id"], is_admin=False, team=True)
        ctx_a = Ctx(1, True, True)
        private = crud.create_item(self.conn, "tasks", {"title": "Mio privato", "visibility": "privato"}, ctx_a)
        shared = crud.create_item(self.conn, "tasks", {"title": "Condiviso"}, ctx_a)
        assigned = crud.create_item(self.conn, "tasks", {"title": "Per Bruno", "visibility": "privato",
                                                         "assignee_id": ctx_b.user_id}, ctx_a)
        seen = {t["id"] for t in crud.list_items(self.conn, "tasks", {}, ctx_b)}
        self.assertEqual(seen, {shared["id"], assigned["id"]})
        with self.assertRaises(NotFound):
            crud.get_item(self.conn, "tasks", private["id"], ctx_b)
        # chi riceve un task privato può lavorarci (non è un elemento di un altro)
        crud.update_item(self.conn, "tasks", assigned["id"], {"status": "chiuso"}, ctx_b)
        with self.assertRaises(NotFound):
            crud.update_item(self.conn, "tasks", private["id"], {"title": "x"}, ctx_b)
        crud.update_item(self.conn, "tasks", shared["id"], {"status": "in_corso"}, ctx_b)
        self.assertEqual(crud.get_item(self.conn, "tasks", shared["id"], ctx_a)["assignee_id"], 1)
        with self.assertRaises(Forbidden):
            auth.create_user(self.conn, {"name": "C", "username": "c", "password": "password-lunga-3"}, ctx_b)

    def test_login(self):
        auth.setup_admin(self.conn, "Anna", "anna", "password-lunga-1")
        with self.assertRaises(Forbidden):
            auth.setup_admin(self.conn, "X", "x", "password-lunga-1")
        token = auth.login(self.conn, "ANNA", "password-lunga-1")
        self.assertEqual(auth.user_for_token(self.conn, token)["id"], 1)
        with self.assertRaises(ValidationError):
            auth.login(self.conn, "anna", "sbagliata")
        auth.logout(self.conn, token)
        self.assertIsNone(auth.user_for_token(self.conn, token))


class BackupLegacyTest(Base):
    def test_export_import_roundtrip(self):
        cu = self.mk("customers", name="Cli")
        t = self.mk("tasks", title="T", customer_id=cu["id"])
        ops.set_subtasks(self.conn, t["id"], [{"title": "s"}])
        self.mk("checklist_templates", name="C", steps=["a", "b"])
        data = json.loads(json.dumps(backup.export_data(self.conn)))
        crud.delete_item(self.conn, "customers", cu["id"])
        counts = backup.import_data(self.conn, data)
        self.assertEqual(counts["tasks"], 1)
        self.assertEqual(crud.get_item(self.conn, "tasks", t["id"])["customer_id"], cu["id"])
        self.assertEqual(crud.list_items(self.conn, "checklist_templates")[0]["steps"], ["a", "b"])

    def test_daily_backup(self):
        ops.put_settings(self.conn, {"backup_dir": str(self.dir / "bk")})
        r = backup.ensure_daily_backup(self.conn, TODAY)
        self.assertTrue(r["done"])
        self.assertTrue((self.dir / "bk" / f"plancia_{TODAY.isoformat()}.db").is_file())
        self.assertFalse(backup.ensure_daily_backup(self.conn, TODAY)["done"])

    def _old_db(self):
        old_dir = self.dir / "old" / "data"
        old_dir.mkdir(parents=True)
        path = old_dir / "activity_desk.db"
        c = sqlite3.connect(path)
        for f in sorted((Path(__file__).parent / "legacy_schema").glob("*.sql")):
            for st in _statements(f.read_text(encoding="utf-8")):
                c.execute(st)
        now = "2026-10-01T10:00:00"
        c.execute("INSERT INTO customers (id,name,code,created_at,updated_at) VALUES (1,'Ferretti','FRL',?,?)", (now, now))
        c.execute("INSERT INTO projects (id,name,customer_id,created_at,updated_at) VALUES (1,'Monit',1,?,?)", (now, now))
        c.execute("INSERT INTO incidents (id,title,customer_id,started_at,created_at,updated_at) VALUES (1,'Down',1,?,?,?)", (now, now, now))
        c.execute("INSERT INTO tasks (id,title,incident_id,created_at,updated_at) VALUES (1,'Analisi',1,?,?)", (now, now))
        c.execute("INSERT INTO tasks (id,title,project_id,status,closed_at,created_at,updated_at) VALUES (2,'Fatto','1','chiuso',?,?,?)", (now, now, now))
        c.execute("INSERT INTO contacts (id,name,is_consultant,is_service_manager,created_at,updated_at) VALUES (1,'Luca',1,1,?,?)", (now, now))
        c.execute("INSERT INTO service_manager_customers VALUES (1,1)")
        c.execute("INSERT INTO tasks (id,title,created_at,updated_at) VALUES (3,'Consulenza',?,?)", (now, now))
        c.execute("INSERT INTO consultations (id,task_id,consultant_id,customer_id,date_start,created_at,updated_at) VALUES (1,3,1,1,'2026-10-02',?,?)", (now, now))
        c.execute("INSERT INTO changes (id,title,customer_id,incident_id,created_at,updated_at) VALUES (1,'Fix',1,1,?,?)", (now, now))
        c.execute("INSERT INTO inbox_items (id,text,processed_at,converted_type,converted_id,created_at,updated_at) VALUES (1,'x',?,'incidents',1,?,?)", (now, now, now))
        c.execute("INSERT INTO events (id,title,start,created_at,updated_at) VALUES (1,'Call','2026-10-05T10:00',?,?)", (now, now))
        (old_dir / "allegati" / "2026" / "10").mkdir(parents=True)
        (old_dir / "allegati" / "2026" / "10" / ("a" * 32 + ".pdf")).write_bytes(b"%PDF")
        c.execute("INSERT INTO attachments (entity_type,entity_id,kind,name,stored_name,mime,size,created_at) VALUES ('tasks',2,'file','doc.pdf',?, 'application/pdf',4,?)",
                  ("2026/10/" + "a" * 32 + ".pdf", now))
        c.commit()
        c.close()
        return path

    def test_legacy_import(self):
        path = self._old_db()
        counts = legacy.import_legacy(self.conn, path)
        self.assertEqual(counts["tasks"], 3)
        self.assertEqual(counts["files_copied"], 1)
        t1 = crud.get_item(self.conn, "tasks", 1)
        self.assertEqual(t1["customer_id"], 1)
        self.assertIn("Down", t1["notes"])
        self.assertEqual(crud.get_item(self.conn, "tasks", 2)["customer_code"], "FRL")
        self.assertEqual(crud.get_item(self.conn, "tasks", 3)["kind"], "consulenza")
        self.assertEqual(crud.get_item(self.conn, "customers", 1)["service_managers"][0]["name"], "Luca")
        self.assertEqual(crud.get_item(self.conn, "events", 1)["end"], "2026-10-05T10:00")
        with self.assertRaises(ValidationError):
            legacy.import_legacy(self.conn, path)
        legacy.import_legacy(self.conn, path, replace=True)
        self.assertEqual(len(crud.list_items(self.conn, "tasks")), 3)


if __name__ == "__main__":
    unittest.main()
