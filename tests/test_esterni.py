"""Meteo e notizie: con risposte d'esempio nel formato dei servizi veri (le prove non vanno su internet)."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from server import auth, esterni, ops
from server.crud import ValidationError
from server.db import open_db

GEO = {"results": [{"name": "Trento", "latitude": 46.06787, "longitude": 11.12108, "country": "Italia", "admin1": "Trentino-Alto Adige"}]}
FORECAST = {
    "current": {"time": "2026-11-26T10:15", "temperature_2m": 6.4, "apparent_temperature": 4.1, "relative_humidity_2m": 71,
                "weather_code": 2, "wind_speed_10m": 8.3},
    "hourly": {"time": [f"2026-11-26T{h:02d}:00" for h in range(24)] + [f"2026-11-27T{h:02d}:00" for h in range(24)],
               "temperature_2m": [float(h % 24) for h in range(48)], "weather_code": [61] * 48, "precipitation_probability": [40] * 48},
    "daily": {"time": ["2026-11-26", "2026-11-27"], "weather_code": [61, 0], "temperature_2m_max": [9.2, 11.0],
              "temperature_2m_min": [1.5, -0.4], "precipitation_probability_max": [70, 5],
              "sunrise": ["2026-11-26T07:24", "2026-11-27T07:25"], "sunset": ["2026-11-26T16:38", "2026-11-27T16:37"]},
}
RSS = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Nuova vulnerabilità critica nei firewall - Il Sole 24 ORE</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
<pubDate>Wed, 26 Nov 2026 08:00:00 GMT</pubDate><source url="https://www.ilsole24ore.com">Il Sole 24 ORE</source></item>
<item><title>Link non web</title><link>javascript:alert(1)</link></item>
<item><title>Doppione</title><link>https://news.google.com/rss/articles/abc?oc=5</link></item>
</channel></rss>"""
ATOM = """<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
<entry><title>Rilascio 2.0</title><link rel="alternate" href="https://example.com/2-0"/><updated>2026-11-25T10:00:00Z</updated></entry></feed>"""


class EsterniTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.conn = open_db(self.dir / "data" / "plancia.db")
        auth.ensure_local_user(self.conn)
        esterni.clear_cache()
        self.calls = []

        def fake(url):
            self.calls.append(url)
            if "geocoding-api" in url:
                return json.dumps(GEO).encode()
            if "api.open-meteo.com" in url:
                return json.dumps(FORECAST).encode()
            if "news.google.com" in url:
                return RSS.encode()
            if "example.com/feed" in url:
                return ATOM.encode()
            raise OSError("non raggiungibile")
        self._orig = esterni.fetch
        esterni.fetch = fake

    def tearDown(self):
        esterni.fetch = self._orig
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_weather(self):
        [place] = esterni.search_places("Trento")
        self.assertEqual((place["name"], place["lat"]), ("Trento", 46.0679))
        ops.put_settings(self.conn, {"weather_place": place})
        w = esterni.weather(ops.get_settings(self.conn)["weather_place"])
        self.assertEqual((w["current"]["temp"], w["current"]["text"], w["current"]["icon"]), (6.4, "Parzialmente nuvoloso", "sole-nuvola"))
        self.assertEqual((w["today"]["max"], w["today"]["min"], w["today"]["rain"], w["today"]["text"]), (9.2, 1.5, 70, "Pioggia debole"))
        self.assertEqual(w["tomorrow"]["text"], "Sereno")
        self.assertEqual([x["time"] for x in w["hours"]], ["10:00", "13:00", "16:00", "19:00"])
        esterni.weather(place)  # dalla memoria: nessuna nuova richiesta
        self.assertEqual(sum("//api.open-meteo.com" in c for c in self.calls), 1)
        self.assertEqual(esterni.weather(None), {"place": None})

    def test_news_topics_and_feeds(self):
        ops.put_settings(self.conn, {"news_topics": ["cybersecurity", " ", "cybersecurity", "NetEye"],
                                     "news_feeds": [{"name": "Blog", "url": "https://example.com/feed"}, {"name": "Rotto", "url": "https://rotto.example.org/rss"}]})
        s = ops.get_settings(self.conn)
        self.assertEqual(s["news_topics"], ["cybersecurity", "NetEye"])
        n = esterni.news(s["news_topics"], s["news_feeds"])
        self.assertEqual([x["title"] for x in n["sections"]], ["cybersecurity", "NetEye", "Blog"])
        first = n["sections"][0]["items"]
        self.assertEqual(len(first), 1)  # niente link non web né doppioni
        self.assertEqual((first[0]["title"], first[0]["source"]), ("Nuova vulnerabilità critica nei firewall", "Il Sole 24 ORE"))
        self.assertEqual(n["sections"][2]["items"][0]["link"], "https://example.com/2-0")
        self.assertEqual([e["title"] for e in n["errors"]], ["Rotto"])
        self.assertIn("q=cybersecurity", self.calls[0])

    def test_validation(self):
        with self.assertRaises(ValidationError):
            ops.put_settings(self.conn, {"news_feeds": [{"url": "file:///etc/passwd"}]})
        with self.assertRaises(ValidationError):
            ops.put_settings(self.conn, {"weather_place": {"lat": 200, "lon": 0}})
        with self.assertRaises(ValidationError):
            esterni.parse_feed('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><rss><channel><item><title>&a;</title></item></channel></rss>')
        ops.put_settings(self.conn, {"weather_place": None})
        self.assertIsNone(ops.get_settings(self.conn)["weather_place"])


if __name__ == "__main__":
    unittest.main()
