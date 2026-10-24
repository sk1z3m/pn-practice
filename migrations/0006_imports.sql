-- Each upload on the Import tab is recorded so it can be undone
CREATE TABLE IF NOT EXISTS imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  courses     TEXT NOT NULL DEFAULT '',
  count       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'draft'
);
ALTER TABLE questions ADD COLUMN import_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_questions_import ON questions(import_id);
-- Backfill: earlier uploads are the groups of questions that share a created_at (the built-in samples, ids 1–36, are excluded)
INSERT INTO imports (created_at, courses, count, status)
  SELECT created_at, GROUP_CONCAT(DISTINCT course), COUNT(*), MAX(status) FROM questions WHERE id > 36 GROUP BY created_at ORDER BY created_at;
UPDATE questions SET import_id = (SELECT i.id FROM imports i WHERE i.created_at = questions.created_at) WHERE id > 36;
