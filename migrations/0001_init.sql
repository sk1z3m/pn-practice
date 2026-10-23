-- PN Practice: initial schema

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL UNIQUE,         -- SHA-256 of the study code (code itself is never stored)
  nickname     TEXT NOT NULL,
  nickname_lc  TEXT NOT NULL UNIQUE,         -- lowercase copy so nicknames are unique ignoring case
  hidden       INTEGER NOT NULL DEFAULT 0,   -- 1 = removed from leaderboards by an admin
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course      TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT 'General',
  stem        TEXT NOT NULL,
  options     TEXT NOT NULL,                 -- JSON array of option strings
  answer      INTEGER NOT NULL,              -- index into options
  rationale   TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',      -- deck / slide reference for checking
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_status_course ON questions(status, course);

CREATE TABLE IF NOT EXISTS ranked_tests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  course       TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  opens_at     INTEGER NOT NULL,             -- epoch ms
  closes_at    INTEGER NOT NULL,             -- epoch ms
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ranked_questions (
  test_id      INTEGER NOT NULL REFERENCES ranked_tests(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES questions(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (test_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_ranked_questions_q ON ranked_questions(question_id);

CREATE TABLE IF NOT EXISTS ranked_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id       INTEGER NOT NULL REFERENCES ranked_tests(id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  started_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  score         INTEGER,
  total         INTEGER,
  answers       TEXT,                        -- JSON {questionId: chosenIndex}
  UNIQUE (test_id, player_id)
);

CREATE TABLE IF NOT EXISTS practice_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  correct      INTEGER NOT NULL,
  answered_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_practice_player ON practice_answers(player_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_practice_time ON practice_answers(answered_at);
