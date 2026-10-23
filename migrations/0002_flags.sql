-- Student flags on questions (wrong answer, unclear wording, etc.)
CREATE TABLE IF NOT EXISTS flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  player_id    TEXT,
  reason       TEXT NOT NULL,
  comment      TEXT NOT NULL DEFAULT '',
  context      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_flags_status_q ON flags(status, question_id);
CREATE INDEX IF NOT EXISTS idx_flags_q ON flags(question_id);
