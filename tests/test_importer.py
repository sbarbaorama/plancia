import base64
import unittest
from datetime import datetime, timezone

from server import importer
from server.importer import ImportError_


def local(y, mo, d, h, mi):
    """Ora locale corrispondente a un istante UTC, nel formato dell'app."""
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M")


class TextTest(unittest.TestCase):
    def test_text_headers_it(self):
        text = (
            "Da: Mario Rossi <mario@acme.it>\n"
            "Inviato: lunedì 2 novembre 2026 09:15\n"
            "A: Sara Neri <sara@acme.it>\n"
            "Oggetto: Problema agent su srv-db-02\n"
            "\n"
            "Ciao,\nl'agent non risponde da stamattina.\n"
        )
        r = importer.parse_text(text)
        self.assertEqual(r["kind"], "mail")
        self.assertEqual(r["sender"], "Mario Rossi")
        self.assertEqual(r["sender_email"], "mario@acme.it")
        self.assertEqual(r["sent_at"], "2026-11-02T09:15")
        self.assertEqual(r["to"], "Sara Neri <sara@acme.it>")
        self.assertEqual(r["subject"], "Problema agent su srv-db-02")
        self.assertEqual(r["body"], "Ciao,\nl'agent non risponde da stamattina.")

    def test_text_headers_en(self):
        text = (
            "From: Paolo Verdi <paolo@vendor.com>\n"
            "Sent: Monday, November 2, 2026 9:15 AM\n"
            "To: me@acme.it\n"
            "Subject: RE: Ticket WP-4821\n\n"
            "We are looking into it."
        )
        r = importer.parse_text(text)
        self.assertEqual(r["sender_email"], "paolo@vendor.com")
        self.assertEqual(r["sent_at"], "2026-11-02T09:15")
        self.assertEqual(r["subject"], "RE: Ticket WP-4821")
        self.assertEqual(r["body"], "We are looking into it.")

    def test_text_no_headers(self):
        r = importer.parse_text("\n\n  Rinnovo licenza NetEye  \nIl preventivo arriva lunedì.\nGrazie")
        self.assertEqual(r["kind"], "mail")
        self.assertEqual(r["subject"], "Rinnovo licenza NetEye")
        self.assertEqual(r["body"], "Il preventivo arriva lunedì.\nGrazie")
        self.assertIsNone(r["sent_at"])

    def test_text_event_range_it(self):
        text = "Oggetto: Riunione fornitori\nQuando: lunedì 3 novembre 2026 15:00-16:30\nDove: Sala riunioni\n\nAgenda allegata"
        r = importer.parse_text(text)
        self.assertEqual(r["kind"], "event")
        self.assertEqual((r["start"], r["end"]), ("2026-11-03T15:00", "2026-11-03T16:30"))
        self.assertEqual(r["location"], "Sala riunioni")

    def test_text_event_numeric(self):
        r = importer.parse_text("Oggetto: Call\nInizio: 03/11/2026 15:00\nFine: 03/11/2026 15:45\n")
        self.assertEqual((r["kind"], r["start"], r["end"]), ("event", "2026-11-03T15:00", "2026-11-03T15:45"))

    def test_text_empty_error(self):
        with self.assertRaises(ImportError_):
            importer.parse_text("   \n ")


EML_PLAIN = (
    "From: Mario Rossi <mario@acme.it>\r\n"
    "To: sara@acme.it\r\n"
    "Subject: Verifica backup\r\n"
    "Date: Mon, 02 Nov 2026 08:15:00 +0000\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n\r\n"
    "Il backup di stanotte è fallito.\r\n"
).encode("utf-8")


class EmlTest(unittest.TestCase):
    def test_eml_plain(self):
        r = importer.parse_eml(EML_PLAIN)
        self.assertEqual((r["kind"], r["subject"], r["sender"], r["sender_email"]), ("mail", "Verifica backup", "Mario Rossi", "mario@acme.it"))
        self.assertEqual(r["sent_at"], local(2026, 11, 2, 8, 15))
        self.assertEqual(r["body"], "Il backup di stanotte è fallito.")

    def test_eml_html_only(self):
        data = (
            "From: a@b.it\r\nSubject: HTML\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
            "<html><head><style>p{color:red}</style></head><body><p>Riga uno</p><p>Riga&nbsp;due &amp; tre<br>quattro</p>"
            "<script>alert(1)</script></body></html>"
        ).encode("utf-8")
        r = importer.parse_eml(data)
        self.assertEqual(r["body"], "Riga uno\nRiga due & tre\nquattro")

    def test_eml_qp_accents(self):
        data = (
            "From: =?iso-8859-1?q?Nicol=F2_Bianchi?= <n@b.it>\r\nSubject: =?utf-8?q?Perch=C3=A9_=C3=A8_gi=C3=B9?=\r\n"
            "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"
            "Citt=E0 e perch=E9\r\n"
        ).encode("ascii")
        r = importer.parse_eml(data)
        self.assertEqual(r["sender"], "Nicolò Bianchi")
        self.assertEqual(r["subject"], "Perché è giù")
        self.assertEqual(r["body"], "Città e perché")

    def test_eml_with_ics_attachment(self):
        ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Upgrade NetEye\r\nDTSTART:20261105T190000Z\r\nDTEND:20261105T210000Z\r\nLOCATION:Teams\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        data = (
            "From: org@acme.it\r\nSubject: Invito: Upgrade NetEye\r\nMIME-Version: 1.0\r\n"
            "Content-Type: multipart/mixed; boundary=XX\r\n\r\n"
            "--XX\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nTi invito all'upgrade.\r\n"
            "--XX\r\nContent-Type: text/calendar; method=REQUEST; charset=utf-8\r\nContent-Disposition: attachment; filename=invite.ics\r\n\r\n"
            + ics + "--XX--\r\n"
        ).encode("utf-8")
        r = importer.parse_eml(data)
        self.assertEqual(r["kind"], "event")
        self.assertEqual(r["start"], local(2026, 11, 5, 19, 0))
        self.assertEqual(r["location"], "Teams")
        self.assertEqual(r["body"], "Ti invito all'upgrade.")


class IcsTest(unittest.TestCase):
    def test_ics_utc(self):
        r = importer.parse_ics("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Call\nDTSTART:20261103T140000Z\nDTEND:20261103T150000Z\nEND:VEVENT\nEND:VCALENDAR\n")
        self.assertEqual((r["kind"], r["subject"]), ("event", "Call"))
        self.assertEqual((r["start"], r["end"]), (local(2026, 11, 3, 14, 0), local(2026, 11, 3, 15, 0)))

    def test_ics_tzid_quoted(self):
        r = importer.parse_ics(
            'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Riunione\r\nDTSTART;TZID="W. Europe Standard Time":20261103T150000\r\n'
            'DTEND;TZID="W. Europe Standard Time":20261103T163000\r\nORGANIZER;CN="Mario Rossi":mailto:mario@acme.it\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
        self.assertEqual((r["start"], r["end"]), ("2026-11-03T15:00", "2026-11-03T16:30"))
        self.assertEqual((r["sender"], r["sender_email"]), ("Mario Rossi", "mario@acme.it"))

    def test_ics_all_day(self):
        r = importer.parse_ics("BEGIN:VEVENT\nSUMMARY:Ferie\nDTSTART;VALUE=DATE:20261110\nDTEND;VALUE=DATE:20261112\nEND:VEVENT\n")
        self.assertTrue(r["all_day"])
        self.assertEqual((r["start"], r["end"]), ("2026-11-10T00:00", "2026-11-11T23:59"))

    def test_ics_folded_and_escaped(self):
        r = importer.parse_ics(
            "BEGIN:VEVENT\r\nSUMMARY:Health check\\, mensile\r\nDTSTART:20261103T090000\r\n"
            "DESCRIPTION:Riga uno\\nRiga due con un testo molto lungo che Outlook spezza\r\n  su più righe\\; fine\r\nEND:VEVENT\r\n")
        self.assertEqual(r["subject"], "Health check, mensile")
        self.assertEqual(r["body"], "Riga uno\nRiga due con un testo molto lungo che Outlook spezza su più righe; fine")
        self.assertEqual(r["start"], "2026-11-03T09:00")

    def test_ics_outlook_web_html_entities(self):
        # Outlook Web mette entità HTML anche nella DESCRIPTION in testo semplice
        r = importer.parse_ics(
            "BEGIN:VEVENT\r\nSUMMARY:Call\r\nDTSTART:20261103T093000Z\r\n"
            "DESCRIPTION:Ciao\\,&nbsp\\; ti chiedo 30 minuti\\n&nbsp\\;\\nGrazie &amp\\; a presto\r\nEND:VEVENT\r\n")
        self.assertEqual(r["body"], "Ciao,  ti chiedo 30 minuti\n\nGrazie & a presto".replace("Ciao,  ", "Ciao, "))

    def test_ics_no_vevent_error(self):
        with self.assertRaises(ImportError_):
            importer.parse_ics("BEGIN:VCALENDAR\nEND:VCALENDAR\n")

    def test_ics_multiple_events_count(self):
        ev = "BEGIN:VEVENT\nSUMMARY:{}\nDTSTART:20261103T090000\nEND:VEVENT\n"
        r = importer.parse_ics(ev.format("Primo") + ev.format("Secondo"))
        self.assertEqual((r["subject"], r["events_in_file"]), ("Primo", 2))


class EncodedTest(unittest.TestCase):
    def test_parse_dispatch(self):
        r = importer.parse("eml", content_b64=base64.b64encode(EML_PLAIN).decode())
        self.assertEqual(r["subject"], "Verifica backup")
        with self.assertRaises(ImportError_):
            importer.parse("eml", content_b64="%%%")
        with self.assertRaises(ImportError_):
            importer.parse("pdf", content="x")
        with self.assertRaises(ImportError_):
            importer.parse("text", content="x" * (importer.MAX_BYTES + 1))


class ReviewFixesTest(unittest.TestCase):
    def test_bad_ics_dates_are_import_errors(self):
        for line in ("DTSTART:20261340T150000", "DTSTART:20261103T250000", "DTSTART:20261399",
                     "DTSTART;VALUE=DATE:2026-11-03", "DTSTART:19600101T100000Z"):
            with self.subTest(line=line):
                with self.assertRaises(ImportError_):
                    importer.parse("ics", content=f"BEGIN:VEVENT\nSUMMARY:x\n{line}\nEND:VEVENT\n")
        with self.assertRaises(ImportError_):
            importer.parse("ics", content="BEGIN:VEVENT\nSUMMARY:x\nDTSTART:20261103T100000\nDTEND;VALUE=DATE:00010101\nEND:VEVENT\n")

    def test_absurd_text_date_no_crash(self):
        r = importer.parse("text", content="Oggetto: x\nQuando: 31/12/9999 23:00-01:00\n")
        self.assertEqual(r["subject"], "x")

    def test_unexpected_errors_become_import_errors(self):
        original = importer.parse_text
        importer.parse_text = lambda text: 1 / 0
        try:
            with self.assertRaises(ImportError_):
                importer.parse("text", content="ciao")
        finally:
            importer.parse_text = original

    def test_corporate_sender_formats(self):
        r = importer.parse_text("Da: Rossi, Mario <m@a.it>\nOggetto: x\n\ny")
        self.assertEqual((r["sender"], r["sender_email"]), ("Rossi, Mario", "m@a.it"))
        r = importer.parse_text("Da: Mario Rossi\nOggetto: x\n\ny")
        self.assertEqual((r["sender"], r["sender_email"]), ("Mario Rossi", ""))
        r = importer.parse_text("From: m@a.it\nSubject: x\n\ny")
        self.assertEqual((r["sender"], r["sender_email"]), ("", "m@a.it"))

    def test_wrapped_header_line(self):
        text = ("Da: Mario <m@a.it>\r\nInviato: lunedì 2 novembre 2026 09:15\r\n"
                "A: Luca <l@x.it>; Anna <a@x.it>;\r\n Paolo Neri <p@x.it>\r\nCc: x@y.it\r\nOggetto: Offerta 2027\r\n\r\nBuongiorno")
        r = importer.parse_text(text)
        self.assertEqual(r["subject"], "Offerta 2027")
        self.assertEqual(r["body"], "Buongiorno")
        self.assertIn("Paolo Neri", r["to"])

    def test_header_word_in_body_only_paste(self):
        r = importer.parse_text("Data: confermata la consegna\nCiao")
        self.assertEqual(r["subject"], "Data: confermata la consegna")
        self.assertEqual(r["body"], "Ciao")

    def test_dalle_alle_and_date_only(self):
        r = importer.parse_text("Oggetto: Call\nQuando: 3 novembre 2026 dalle 15:00 alle 16:30\n")
        self.assertEqual((r["start"], r["end"]), ("2026-11-03T15:00", "2026-11-03T16:30"))
        r = importer.parse_text("Oggetto: Call\nQuando: 3 novembre 2026 ore 15\n")
        self.assertEqual(r["start"], "2026-11-03T15:00")
        r = importer.parse_text("Oggetto: Ferie\nQuando: 3 novembre 2026\n")
        self.assertTrue(r["all_day"])
        self.assertEqual((r["start"], r["end"]), ("2026-11-03T00:00", "2026-11-03T23:59"))

    def test_eml_unknown_charset_keeps_body(self):
        data = b"From: a@b.it\r\nSubject: x\r\nContent-Type: text/plain; charset=x-unknown\r\n\r\nperch\xc3\xa9 s\xc3\xac\r\n"
        self.assertEqual(importer.parse_eml(data)["body"], "perché sì")

    def test_html_table_cells_separated(self):
        self.assertEqual(importer.html_to_text("<table><tr><td>Host</td><td>srv-01</td></tr></table>"), "Host srv-01")


if __name__ == "__main__":
    unittest.main()
