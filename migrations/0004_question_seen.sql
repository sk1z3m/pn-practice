-- Which questions each student has been served, so practice rotates through the whole pool
CREATE TABLE IF NOT EXISTS question_seen (
  player_id    TEXT NOT NULL,
  question_id  INTEGER NOT NULL,
  times_seen   INTEGER NOT NULL DEFAULT 1,
  last_seen    INTEGER NOT NULL,
  PRIMARY KEY (player_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_seen_question ON question_seen(question_id);
-- Backfill from answers already given
INSERT OR IGNORE INTO question_seen (player_id, question_id, times_seen, last_seen)
  SELECT player_id, question_id, COUNT(*), MAX(answered_at) FROM practice_answers GROUP BY player_id, question_id;
