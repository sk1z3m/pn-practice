-- Lets per-question answer counts (admin Questions tab, Recent imports list) look up a question's
-- answers directly instead of scanning every practice answer.
CREATE INDEX IF NOT EXISTS idx_practice_question ON practice_answers(question_id);
