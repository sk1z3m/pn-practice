-- Named groups of topics (e.g. "Test 1") that students can pick in one tap when starting practice.
-- topics is a JSON array of topic names within the course.
CREATE TABLE IF NOT EXISTS topic_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  name TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topic_groups_course ON topic_groups(course);
