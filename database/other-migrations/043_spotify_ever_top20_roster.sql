CREATE TABLE IF NOT EXISTS sh_spotify_top20_history (
  ranking_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 20),
  PRIMARY KEY (ranking_date, artist_key)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_top20_history_artist
  ON sh_spotify_top20_history (artist_key, ranking_date);

-- sh_spotify_artists is intentionally additive. Once an artist enters the Top 20,
-- it stays in this table and remains part of the daily playcount collection roster.
INSERT INTO sh_spotify_artists (artist_key, spotify_artist_id, artist_name) VALUES
  ('equal-love', '1j2WhcTW00Zd2SjFYsJVc6', '＝LOVE'),
  ('akb48', '01wau5CL3Z1vfJJWkzBkqg', 'AKB48'),
  ('cutie-street', '3PLCOySHJ9zwED5yZvDtPZ', 'CUTIE STREET'),
  ('fruits-zipper', '4v5IVXt3oH0iNuxW9O36BV', 'FRUITS ZIPPER'),
  ('nogizaka46', '08lN7bm4Etec8ETFxaTUmq', '乃木坂46'),
  ('candy-tune', '4Yq4M6kdQTjkPBOp7aPJrA', 'CANDY TUNE'),
  ('ilife', '539GTPlYhFLCL6eh4jnbYy', 'iLiFE!'),
  ('niziu', '3z8diLlUCkN1j9N9ZdnfBJ', 'NiziU'),
  ('momoiro-clover-z', '3Zl0EsuYV23OgNw6WqGelN', 'ももいろクローバーZ'),
  ('phantom-siita', '6JO3HrRYUfSMbe71R7RUF2', 'ファントムシータ'),
  ('morning-musume', '4cDFYGC0CtsN86zvpCXsi4', 'モーニング娘。'),
  ('mei', '0wsE3L0l083t6bxC8jJefC', 'ME:I'),
  ('cho-tokimeki-sendenbu', '02hwDSWEF0JdOgdIBw1gRT', '超ときめき♡宣伝部'),
  ('not-equal-me', '3e3ubSlRDBFxokscDrbvpF', '≠ME'),
  ('juice-juice', '6ckfItpfxpSYKrZ0OIXUuh', 'Juice=Juice'),
  ('sakurazaka46', '0Ti7MfCiVVQAK8zLSiqlto', '櫻坂46'),
  ('piki', '0k24bjTbB2IUhV74mvSv4T', 'PiKi'),
  ('hinatazaka46', '0eQSoTI7sQENREQM8Klp2j', '日向坂46'),
  ('kyururin-tte-shitemite', '1tIFdPigPQapjr9pOEDP7d', 'きゅるりんってしてみて'),
  ('sweet-steady', '1UyIqMBjk0DMexWtQF2X1i', 'SWEET STEADY')
ON CONFLICT(artist_key) DO UPDATE SET
  spotify_artist_id=excluded.spotify_artist_id,
  artist_name=excluded.artist_name;

INSERT INTO sh_spotify_top20_history (ranking_date, artist_key, rank) VALUES
  ('2026-09-23', 'equal-love', 1),
  ('2026-09-23', 'akb48', 2),
  ('2026-09-23', 'cutie-street', 3),
  ('2026-09-23', 'fruits-zipper', 4),
  ('2026-09-23', 'nogizaka46', 5),
  ('2026-09-23', 'candy-tune', 6),
  ('2026-09-23', 'ilife', 7),
  ('2026-09-23', 'niziu', 8),
  ('2026-09-23', 'momoiro-clover-z', 9),
  ('2026-09-23', 'phantom-siita', 10),
  ('2026-09-23', 'morning-musume', 11),
  ('2026-09-23', 'mei', 12),
  ('2026-09-23', 'cho-tokimeki-sendenbu', 13),
  ('2026-09-23', 'not-equal-me', 14),
  ('2026-09-23', 'juice-juice', 15),
  ('2026-09-23', 'sakurazaka46', 16),
  ('2026-09-23', 'piki', 17),
  ('2026-09-23', 'hinatazaka46', 18),
  ('2026-09-23', 'kyururin-tte-shitemite', 19),
  ('2026-09-23', 'sweet-steady', 20)
ON CONFLICT(ranking_date, artist_key) DO UPDATE SET rank=excluded.rank;
