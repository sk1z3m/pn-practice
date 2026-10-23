// Builds seed/seed.sql from seed/sample-questions.json (sample questions + one sample ranked test).
import { readFileSync, writeFileSync } from 'node:fs';
const { questions } = JSON.parse(readFileSync(new URL('../seed/sample-questions.json', import.meta.url)));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = Date.now();
const lines = [];
questions.forEach((x, i) => {
  lines.push(`INSERT INTO questions (id, course, topic, stem, options, answer, rationale, source, status, created_at, updated_at) VALUES (${i + 1}, ${q(x.course)}, ${q(x.topic)}, ${q(x.stem)}, ${q(JSON.stringify(x.options))}, ${x.answer}, ${q(x.rationale)}, ${q('Sample question (not from course decks)')}, 'approved', ${now}, ${now});`);
});
// Sample ranked test: questions 9–18 (sedatives + psychotherapeutics), open now until Sun Nov 1 2026, 11:59 pm Atlantic.
const opens = Date.parse('2026-10-23T00:00:00-03:00');
const closes = Date.parse('2026-11-01T23:59:00-04:00');
lines.push(`INSERT INTO ranked_tests (id, title, course, description, opens_at, closes_at, created_at) VALUES (1, ${q('Sample Ranked: Sedatives & Psych Meds')}, ${q('Pharmacology')}, ${q('10 questions, one attempt. Answers unlock when the test closes.')}, ${opens}, ${closes}, ${now});`);
for (let i = 0; i < 10; i++) lines.push(`INSERT INTO ranked_questions (test_id, question_id, position) VALUES (1, ${9 + i}, ${i});`);
writeFileSync(new URL('../seed/seed.sql', import.meta.url), lines.join('\n') + '\n');
console.log(`wrote ${questions.length} questions + 1 ranked test`);
