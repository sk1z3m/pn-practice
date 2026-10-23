// Extracts question banks from saved quiz pages (earlier study artifacts) into import-ready JSON.
// Usage: node scripts/extract-quizzes.mjs <quizsrc dir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const [, , SRC, OUT] = process.argv;

const PH = 'Pharmacology', MC = 'Maternal/Child', CN = 'Community Nursing';
const T = {
  pain1: 'Pain: opioids & acetaminophen', pain2: 'Pain: NSAIDs & cannabis',
  sed: 'Sedatives & hypnotics', psych: 'Psychotherapeutics',
  resp1: 'Respiratory: colds, allergies & cough', resp2: 'Respiratory: asthma & COPD', integ: 'Integumentary drugs',
};
const CH = { 3: 'Ch 3: Fetal development', 4: 'Ch 4: Prenatal care', 5: 'Ch 5: Pregnancy complications', 6: 'Ch 6: Labour & birth', 7: 'Ch 7: Pain management in labour', 8: 'Ch 8: Labour complications' };

// CNS topic from a unit label or the slide tag in the rationale
function cnsTopic(u, e) {
  const s = `${u || ''} ${e || ''}`;
  if (/Pain ?1|Pain Part 1/i.test(u || '')) return T.pain1;
  if (/Pain ?2|Pain Part 2/i.test(u || '')) return T.pain2;
  if (/Sed|Benzo/i.test(u || '')) return T.sed;
  if (/Psych/i.test(u || '')) return T.psych;
  if (/\[Pain 1/.test(s)) return T.pain1;
  if (/\[Pain 2/.test(s)) return T.pain2;
  if (/\[Sed/.test(s)) return T.sed;
  if (/\[Psych/.test(s)) return T.psych;
  return 'CNS mixed review';
}
function mat3Topic(stem) {
  if (/newborn|neonat|infant|apgar|jaundice|vitamin k|cord clamp|thermoreg|vernix|fontanel|baby/i.test(stem)) return 'Ch 11–12: Newborn';
  if (/postpartum|lochia|fundus|breast|lactat|involution|PPH|after birth|mastitis/i.test(stem)) return 'Ch 9–10: Postpartum';
  return 'Ch 8: Labour complications';
}

// page dir -> [course, title, topic function]
const PAGES = {
  pain1: [PH, 'Pain Part 1 Quiz', () => T.pain1],
  pain2: [PH, 'Pain Part 2 Quiz', () => T.pain2],
  opioids: [PH, 'Opioids Focused Quiz', () => T.pain1],
  nsaids: [PH, 'NSAIDs Focused Quiz', () => T.pain2],
  benzos: [PH, 'Benzodiazepines Quiz', () => T.sed],
  barbs: [PH, 'Barbiturates & Sleep Aids Quiz', () => T.sed],
  antidep: [PH, 'Antidepressants Quiz', () => T.psych],
  antipsych: [PH, 'Antipsychotics Quiz', () => T.psych],
  cnsfull: [PH, 'CNS Drugs Full Quiz', (q) => cnsTopic(q.u, q.rationale)],
  cnspractice: [PH, 'CNS Drugs Practice Test', (q) => cnsTopic(q.u, q.rationale)],
  matnight: [PH, 'Night Before Quiz (CNS)', (q) => cnsTopic('', q.rationale)],
  resp1: [PH, 'Respiratory Part 1 Retest', () => T.resp1],
  resp2: [PH, 'Respiratory Part 2 Pre-test', () => T.resp2],
  integ: [PH, 'Integumentary Drugs Quiz', () => T.integ],
  mat2a: [MC, 'Maternity Quiz 2 Practice', (q) => CH[q.ch] || 'Ch 3–8 review'],
  mat2b: [MC, 'Maternity Quiz 2 Practice Set 2', (q) => CH[q.ch] || 'Ch 3–8 review'],
  mat2c: [MC, 'Maternity Quiz 2 Practice Set 3', (q) => CH[q.ch] || 'Ch 3–8 review'],
  signs: [MC, 'Signs of Pregnancy Drill', () => CH[4]],
  prenatal: [MC, 'Prenatal Care Quiz', () => CH[4]],
  adapt: [MC, 'Pregnancy Adaptations Retest', () => 'Ch 4: Pregnancy adaptations'],
  complic: [MC, 'Pregnancy Complications Retest', () => CH[5]],
  fetal1: [MC, 'Fetal Development Drill', () => CH[3]],
  fetal2: [MC, 'Fetal Development Retest', () => CH[3]],
  matwarm: [MC, 'Quiz Day Warm-Up (Maternity Quiz 3)', (q) => mat3Topic(q.stem)],
  ch1: [CN, 'Chapter 1 Retest', () => 'Ch 1: Health & health promotion'],
  ch21: [CN, 'Chapter 21 Retest', () => 'Ch 21: Patient education'],
  hpself: [CN, 'Health Promotion Self-Test', () => 'Health promotion: Quiz 1 review'],
  hpwarm: [CN, 'Quiz Day Warm-up (Health Promotion)', () => 'Health promotion: Quiz 1 review'],
  sunday: [null, 'Sunday Retests', null], // mixed sets; handled below
};
const SUNDAY = {
  hp: [CN, () => 'Health promotion: Quiz 1 review'],
  ud: [CN, () => 'Health promotion: Quiz 1 review'],
  mc: [MC, () => CH[3]],
  ph: [PH, () => T.integ],
};

// Pull a balanced [...] or {...} literal that starts at index i
function literalAt(src, i) {
  const open = src[i], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = null, esc = false;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced literal');
}
// Evaluate a data literal in an empty sandbox (no require, no globals), with a timeout
function evalLiteral(text) {
  return vm.runInNewContext(`(${text})`, Object.create(null), { timeout: 500 });
}
function declarations(src) {
  const out = {};
  const re = /(?:const|let)\s+(Q|BANK\d*|POOL|SETS)\s*=\s*([\[{])/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length - 1;
    try { out[m[1]] = evalLiteral(literalAt(src, start)); } catch { /* references other vars, e.g. matwarm SETS */ }
  }
  return out;
}

function norm(item) {
  if (Array.isArray(item)) {
    const [stem, options, answer, rationale] = item;
    return { stem, options, answer, rationale };
  }
  return {
    stem: item.q ?? item.p ?? item.question, options: item.o ?? item.options,
    answer: item.c ?? item.a ?? item.answer, rationale: item.e ?? item.rationale ?? '',
    u: item.u, ch: item.ch,
  };
}
// Make wording fit a shared class site rather than one student's study page
function tidy(s) {
  return String(s ?? '')
    .replace(/\bYour handwritten note\b/g, 'Handwritten note on the slide')
    .replace(/\byour handwritten note\b/g, 'the handwritten note on the slide')
    .replace(/\bYour slide notes say\b/g, 'The slide notes say')
    .replace(/\bon your slides?\b/g, 'on the slides')
    .replace(/\b[Yy]our slides?\b/g, (m) => (m[0] === 'Y' ? 'The slides' : 'the slides'))
    .replace(/\bYour slide\b/g, 'The slide')
    .replace(/\s+/g, ' ').trim();
}
function slideRefs(e) {
  const m = String(e).match(/\[([^\]]*(?:slide|Sed|Psych|Pain|P1)[^\]]*)\]/i);
  return m ? m[1] : '';
}

const all = [];
const stats = {};
for (const [dir, [course, title, topicFn]] of Object.entries(PAGES)) {
  const src = readFileSync(join(SRC, dir, 'index.html'), 'utf8');
  const d = declarations(src);
  let groups = [];
  if (dir === 'sunday') {
    for (const [key, set] of Object.entries(d.SETS || {})) {
      const map = SUNDAY[key];
      if (map && Array.isArray(set.q)) groups.push([map[0], `Sunday Retests: ${set.title}`, map[1], set.q]);
    }
  } else {
    const items = [...(d.Q || []), ...(d.POOL || []), ...Object.keys(d).filter((k) => /^BANK/.test(k)).flatMap((k) => d[k])];
    groups.push([course, title, topicFn, items]);
  }
  let n = 0;
  for (const [c, t, tf, items] of groups) {
    for (const raw of items) {
      const q = norm(raw);
      if (!q.stem || !Array.isArray(q.options) || !Number.isInteger(q.answer)) continue;
      if (/kahoot/i.test(q.rationale)) continue; // instructor's own quiz content stays out
      const stem = tidy(q.stem), options = q.options.map(tidy), rationale = tidy(q.rationale);
      if (options.length < 2 || options.length > 6 || q.answer < 0 || q.answer >= options.length) continue;
      const ref = slideRefs(q.rationale);
      all.push({
        course: c, topic: tf({ ...q, stem }), stem, options, answer: q.answer, rationale,
        source: ref ? `${t} · ${ref}` : t,
      });
      n++;
    }
  }
  stats[dir] = n;
}

// De-duplicate on normalised question text (first occurrence wins; focused quizzes are listed first)
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const seen = new Set();
const unique = all.filter((q) => {
  const k = key(q.stem);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const byTopic = {};
for (const q of unique) byTopic[`${q.course} / ${q.topic}`] = (byTopic[`${q.course} / ${q.topic}`] || 0) + 1;
writeFileSync(OUT, JSON.stringify({ questions: unique }, null, 1));
console.log('per page:', stats);
console.log(`extracted ${all.length}, unique ${unique.length}`);
console.table(byTopic);
