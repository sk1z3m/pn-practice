-- Messages to students, e.g. "a question you answered was corrected"
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL,
  question_id  INTEGER,
  kind         TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  read_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_player ON notifications(player_id, read_at);
