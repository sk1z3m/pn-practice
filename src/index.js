// PN Practice — Cloudflare Worker API
// Static pages in /public are served by Workers Assets; everything under /api lands here.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (message, status = 400) => json({ error: message }, status);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- helpers ----------

const ANIMALS = ['OTTER', 'HERON', 'MOOSE', 'PUFFIN', 'LYNX', 'BEAVER', 'RAVEN', 'FALCON', 'BISON', 'WALRUS',
  'BADGER', 'MARTEN', 'OSPREY', 'SEAL', 'FOX', 'HARE', 'OWL', 'ORCA', 'CRANE', 'LOON'];
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L

function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function newCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[randInt(CODE_CHARS.length)];
  return `${ANIMALS[randInt(ANIMALS.length)]}-${s}`;
}
function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Options are sent as [{i, text}] in shuffled order; i is the original index the server scores against.
function presentQuestion(q) {
  const options = JSON.parse(q.options).map((text, i) => ({ i, text }));
  return { id: q.id, course: q.course, topic: q.topic, stem: q.stem, options: shuffle(options) };
}
async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}
function cleanText(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

const NICK_RE = /^[A-Za-z0-9 _.'\-]{2,20}$/;

async function getPlayer(env, request) {
  const code = normalizeCode(request.headers.get('x-player-code'));
  if (!code) return null;
  return env.DB.prepare('SELECT id, nickname, hidden, leaderboard_opt_out, lb_prompted FROM players WHERE code_hash = ?')
    .bind(await sha256(code)).first();
}
async function requirePlayer(env, request) {
  const p = await getPlayer(env, request);
  if (!p) throw new HttpError(401, 'Study code not recognised');
  return p;
}

// Questions locked into ranked tests that haven't closed yet are kept out of practice
// (otherwise practice mode could be used to look up ranked answers).
const LOCKED_SQL = `SELECT rq.question_id FROM ranked_questions rq
  JOIN ranked_tests t ON t.id = rq.test_id WHERE t.closes_at > ?`;

function testStatus(t, now) {
  if (now < t.opens_at) return 'upcoming';
  if (now >= t.closes_at) return 'closed';
  return 'open';
}

// ---------- public routes ----------

async function createPlayer(env, request) {
  const body = await readBody(request);
  const nickname = cleanText(body.nickname, 40).replace(/\s+/g, ' ');
  if (!NICK_RE.test(nickname)) throw new HttpError(400, 'Nickname must be 2–20 letters, numbers, spaces, or . _ - \'');
  const taken = await env.DB.prepare('SELECT 1 FROM players WHERE nickname_lc = ?').bind(nickname.toLowerCase()).first();
  if (taken) throw new HttpError(409, 'That nickname is taken');

  for (let tries = 0; tries < 5; tries++) {
    const code = newCode();
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO players (id, code_hash, nickname, nickname_lc, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, await sha256(code), nickname, nickname.toLowerCase(), Date.now()).run();
      return json({ code, nickname });
    } catch (e) {
      if (String(e).includes('nickname_lc')) throw new HttpError(409, 'That nickname is taken');
      // code collision — try another
    }
  }
  throw new HttpError(500, 'Could not create a code, please try again');
}

async function me(env, request) {
  const p = await requirePlayer(env, request);
  const now = Date.now();
  const week = now - 7 * 864e5;
  const [practice, weekly, ranked, coverage] = await env.DB.batch([
    env.DB.prepare(`SELECT q.course, COUNT(*) AS answered, SUM(pa.correct) AS correct
      FROM practice_answers pa JOIN questions q ON q.id = pa.question_id
      WHERE pa.player_id = ? GROUP BY q.course ORDER BY q.course`).bind(p.id),
    env.DB.prepare(`SELECT COUNT(DISTINCT question_id) AS n FROM practice_answers
      WHERE player_id = ? AND correct = 1 AND answered_at > ?`).bind(p.id, week),
    env.DB.prepare(`SELECT t.id, t.title, a.score, a.total, a.submitted_at FROM ranked_attempts a
      JOIN ranked_tests t ON t.id = a.test_id WHERE a.player_id = ? AND a.submitted_at IS NOT NULL
      ORDER BY a.submitted_at DESC`).bind(p.id),
    env.DB.prepare(`SELECT q.course, COUNT(*) AS total, COUNT(s.question_id) AS seen
      FROM questions q LEFT JOIN question_seen s ON s.question_id = q.id AND s.player_id = ?
      WHERE q.status = 'approved' GROUP BY q.course ORDER BY q.course`).bind(p.id),
  ]);
  return json({
    nickname: p.nickname,
    hidden: !!p.hidden,
    onLeaderboard: !p.leaderboard_opt_out,
    lbPrompted: !!p.lb_prompted,
    practice: practice.results,
    weeklyCorrect: weekly.results[0]?.n || 0,
    ranked: ranked.results,
    coverage: coverage.results,
  });
}

// Student settings: leaderboard participation, explainer seen, nickname change
async function updateSettings(env, request) {
  const p = await requirePlayer(env, request);
  const body = await readBody(request);
  const sets = [], binds = [];
  if (body.onLeaderboard != null) { sets.push('leaderboard_opt_out = ?'); binds.push(body.onLeaderboard ? 0 : 1); }
  if (body.lbPrompted) sets.push('lb_prompted = 1');
  let nickname = p.nickname;
  if (body.nickname != null) {
    nickname = cleanText(body.nickname, 40).replace(/\s+/g, ' ');
    if (!NICK_RE.test(nickname)) throw new HttpError(400, 'Nickname must be 2–20 letters, numbers, spaces, or . _ - \'');
    if (nickname !== p.nickname) {
      const taken = await env.DB.prepare('SELECT 1 FROM players WHERE nickname_lc = ? AND id != ?').bind(nickname.toLowerCase(), p.id).first();
      if (taken) throw new HttpError(409, 'That nickname is taken');
      sets.push('nickname = ?', 'nickname_lc = ?'); binds.push(nickname, nickname.toLowerCase());
    }
  }
  if (sets.length) await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, p.id).run();
  const r = await env.DB.prepare('SELECT nickname, leaderboard_opt_out, lb_prompted FROM players WHERE id = ?').bind(p.id).first();
  return json({ nickname: r.nickname, onLeaderboard: !r.leaderboard_opt_out, lbPrompted: !!r.lb_prompted });
}

async function catalog(env) {
  const { results } = await env.DB.prepare(`SELECT course, topic, COUNT(*) AS n FROM questions
    WHERE status = 'approved' AND id NOT IN (${LOCKED_SQL})
    GROUP BY course, topic ORDER BY course, topic`).bind(Date.now()).all();
  const courses = {};
  for (const r of results) {
    (courses[r.course] ||= { course: r.course, total: 0, topics: [] });
    courses[r.course].topics.push({ topic: r.topic, n: r.n });
    courses[r.course].total += r.n;
  }
  return json({ courses: Object.values(courses) });
}

async function practiceStart(env, request) {
  const body = await readBody(request);
  const course = cleanText(body.course, 100);
  const topics = Array.isArray(body.topics) ? body.topics.map((t) => cleanText(t, 100)).filter(Boolean) : [];
  const count = Math.min(Math.max(parseInt(body.count, 10) || 10, 1), 50);
  if (!course) throw new HttpError(400, 'Pick a course');

  let sql = `SELECT id, course, topic, stem, options FROM questions
    WHERE status = 'approved' AND course = ? AND id NOT IN (${LOCKED_SQL})`;
  const binds = [course, Date.now()];
  if (topics.length) {
    sql += ` AND topic IN (${topics.map(() => '?').join(',')})`;
    binds.push(...topics);
  }
  const { results: pool } = await env.DB.prepare(sql).bind(...binds).all();
  if (!pool.length) throw new HttpError(404, 'No questions available for that selection yet');

  // Rotation: unseen questions first, then the ones seen longest ago, so a student works through the
  // whole pool before anything repeats. Up to 30% of a round is spaced review of questions they got
  // wrong, but only once at least 12 hours have passed since they last saw them.
  const player = await getPlayer(env, request);
  const seen = new Map();      // question id -> last time served
  const lastResult = new Map(); // question id -> 1 correct / 0 wrong (most recent answer)
  if (player) {
    const [sv, ans] = await env.DB.batch([
      env.DB.prepare('SELECT question_id, last_seen FROM question_seen WHERE player_id = ?').bind(player.id),
      env.DB.prepare('SELECT question_id, correct FROM practice_answers WHERE player_id = ? ORDER BY answered_at').bind(player.id),
    ]);
    for (const r of sv.results) seen.set(r.question_id, r.last_seen);
    for (const r of ans.results) lastResult.set(r.question_id, r.correct);
  } else if (Array.isArray(body.seen)) {
    // No study code: the browser sends the ids it has been served (oldest first)
    body.seen.slice(-2000).forEach((id, i) => { const n = parseInt(id, 10); if (Number.isInteger(n)) seen.set(n, i + 1); });
  }
  const now = Date.now();
  const REVIEW_GAP = 12 * 3600 * 1000;
  const fresh = [], review = [], rest = [];
  for (const q of shuffle(pool)) {
    if (!seen.has(q.id)) fresh.push(q);
    else if (player && lastResult.get(q.id) === 0 && now - seen.get(q.id) >= REVIEW_GAP) review.push(q);
    else rest.push(q);
  }
  review.sort((a, b) => seen.get(a.id) - seen.get(b.id));
  rest.sort((a, b) => seen.get(a.id) - seen.get(b.id)); // longest ago first; ties stay shuffled
  const reviewSlots = Math.min(review.length, Math.floor(count * 0.3));
  const chosen = [...review.slice(0, reviewSlots), ...fresh, ...rest, ...review.slice(reviewSlots)].slice(0, count);
  const picked = shuffle(chosen).map(presentQuestion);
  if (player) await markSeen(env, player.id, chosen.map((q) => q.id), now);
  return json({ questions: picked, poolSize: pool.length, unseen: fresh.length });
}

async function markSeen(env, playerId, ids, now = Date.now()) {
  if (!ids.length) return;
  const stmt = env.DB.prepare(`INSERT INTO question_seen (player_id, question_id, times_seen, last_seen) VALUES (?, ?, 1, ?)
    ON CONFLICT(player_id, question_id) DO UPDATE SET times_seen = times_seen + 1, last_seen = excluded.last_seen`);
  await env.DB.batch(ids.map((id) => stmt.bind(playerId, id, now)));
}


async function practiceAnswer(env, request) {
  const body = await readBody(request);
  const qid = parseInt(body.questionId, 10);
  const choice = parseInt(body.choice, 10);
  const q = await env.DB.prepare(`SELECT id, options, answer, rationale, source FROM questions
    WHERE id = ? AND status = 'approved' AND id NOT IN (${LOCKED_SQL})`).bind(qid, Date.now()).first();
  if (!q) throw new HttpError(404, 'Question not available');
  const nOpts = JSON.parse(q.options).length;
  if (!(choice >= 0 && choice < nOpts)) throw new HttpError(400, 'Invalid choice');
  const correct = choice === q.answer;
  const player = await getPlayer(env, request);
  if (player) {
    await env.DB.prepare('INSERT INTO practice_answers (player_id, question_id, correct, answered_at) VALUES (?, ?, ?, ?)')
      .bind(player.id, q.id, correct ? 1 : 0, Date.now()).run();
  }
  return json({ correct, answer: q.answer, rationale: q.rationale, source: q.source });
}

async function rankedList(env, request) {
  const now = Date.now();
  const player = await getPlayer(env, request);
  const { results } = await env.DB.prepare(`SELECT t.id, t.title, t.course, t.description, t.opens_at, t.closes_at,
      (SELECT COUNT(*) FROM ranked_questions rq WHERE rq.test_id = t.id) AS questionCount,
      (SELECT COUNT(*) FROM ranked_attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS takers
    FROM ranked_tests t ORDER BY t.opens_at DESC LIMIT 100`).all();
  let mine = new Map();
  if (player) {
    const r = await env.DB.prepare('SELECT test_id, submitted_at, score, total FROM ranked_attempts WHERE player_id = ?')
      .bind(player.id).all();
    mine = new Map(r.results.map((a) => [a.test_id, a]));
  }
  return json({
    now,
    tests: results.map((t) => {
      const a = mine.get(t.id);
      return {
        ...t,
        status: testStatus(t, now),
        attempt: a ? { submitted: !!a.submitted_at, score: a.score, total: a.total } : null,
      };
    }),
  });
}

async function loadTest(env, id) {
  const t = await env.DB.prepare('SELECT * FROM ranked_tests WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'Test not found');
  return t;
}
async function loadTestQuestions(env, id) {
  const { results } = await env.DB.prepare(`SELECT q.id, q.course, q.topic, q.stem, q.options, q.answer, q.rationale, q.source
    FROM ranked_questions rq JOIN questions q ON q.id = rq.question_id
    WHERE rq.test_id = ? ORDER BY rq.position`).bind(id).all();
  return results;
}

async function rankedStart(env, request, id) {
  const p = await requirePlayer(env, request);
  const t = await loadTest(env, id);
  const now = Date.now();
  const st = testStatus(t, now);
  if (st !== 'open') throw new HttpError(403, st === 'upcoming' ? 'This test has not opened yet' : 'This test is closed');

  let a = await env.DB.prepare('SELECT * FROM ranked_attempts WHERE test_id = ? AND player_id = ?').bind(id, p.id).first();
  if (a?.submitted_at) throw new HttpError(409, 'You have already taken this test');
  if (!a) {
    await env.DB.prepare('INSERT OR IGNORE INTO ranked_attempts (test_id, player_id, started_at) VALUES (?, ?, ?)')
      .bind(id, p.id, now).run();
    const ids = (await env.DB.prepare('SELECT question_id FROM ranked_questions WHERE test_id = ?').bind(id).all()).results.map((r) => r.question_id);
    await markSeen(env, p.id, ids, now);
    a = await env.DB.prepare('SELECT * FROM ranked_attempts WHERE test_id = ? AND player_id = ?').bind(id, p.id).first();
  }
  const qs = await loadTestQuestions(env, id);
  return json({
    test: { id: t.id, title: t.title, course: t.course, closes_at: t.closes_at },
    startedAt: a.started_at,
    resumed: a.started_at !== now,
    questions: qs.map(presentQuestion),
  });
}

async function rankedSubmit(env, request, id) {
  const p = await requirePlayer(env, request);
  const t = await loadTest(env, id);
  const body = await readBody(request);
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const a = await env.DB.prepare('SELECT * FROM ranked_attempts WHERE test_id = ? AND player_id = ?').bind(id, p.id).first();
  if (!a) throw new HttpError(400, 'Start the test first');
  if (a.submitted_at) throw new HttpError(409, 'Already submitted');
  const now = Date.now();
  if (now > t.closes_at + 10 * 60 * 1000) throw new HttpError(403, 'This test closed before you submitted');

  const qs = await loadTestQuestions(env, id);
  let score = 0;
  const clean = {};
  for (const q of qs) {
    const c = parseInt(answers[q.id], 10);
    if (Number.isInteger(c)) clean[q.id] = c;
    if (c === q.answer) score++;
  }
  const res = await env.DB.prepare(`UPDATE ranked_attempts SET submitted_at = ?, score = ?, total = ?, answers = ?
    WHERE id = ? AND submitted_at IS NULL`).bind(now, score, qs.length, JSON.stringify(clean), a.id).run();
  if (!res.meta.changes) throw new HttpError(409, 'Already submitted');

  const rank = await env.DB.prepare(`SELECT COUNT(*) + 1 AS r FROM ranked_attempts a JOIN players p ON p.id = a.player_id
    WHERE a.test_id = ? AND a.submitted_at IS NOT NULL AND p.hidden = 0 AND p.leaderboard_opt_out = 0 AND a.id != ?
    AND (a.score > ? OR (a.score = ? AND (a.submitted_at - a.started_at) < ?))`)
    .bind(id, a.id, score, score, now - a.started_at).first();
  return json({ score, total: qs.length, durationMs: now - a.started_at, rank: p.leaderboard_opt_out ? null : rank.r, optedOut: !!p.leaderboard_opt_out, closes_at: t.closes_at });
}

async function rankedReview(env, request, id) {
  const t = await loadTest(env, id);
  if (testStatus(t, Date.now()) !== 'closed') {
    throw new HttpError(403, 'Answers unlock when the test closes');
  }
  const player = await getPlayer(env, request);
  let mine = {};
  if (player) {
    const a = await env.DB.prepare('SELECT answers FROM ranked_attempts WHERE test_id = ? AND player_id = ?').bind(id, player.id).first();
    if (a?.answers) mine = JSON.parse(a.answers);
  }
  const qs = await loadTestQuestions(env, id);
  const stats = await env.DB.prepare('SELECT answers FROM ranked_attempts WHERE test_id = ? AND submitted_at IS NOT NULL').bind(id).all();
  const right = {};
  for (const r of stats.results) {
    const ans = JSON.parse(r.answers || '{}');
    for (const q of qs) if (ans[q.id] === q.answer) right[q.id] = (right[q.id] || 0) + 1;
  }
  const takers = stats.results.length;
  return json({
    test: { id: t.id, title: t.title, course: t.course },
    takers,
    questions: qs.map((q) => ({
      id: q.id, topic: q.topic, stem: q.stem, options: JSON.parse(q.options), answer: q.answer,
      rationale: q.rationale, source: q.source,
      yourChoice: mine[q.id] ?? null,
      classPercent: takers ? Math.round((100 * (right[q.id] || 0)) / takers) : null,
    })),
  });
}

async function leaderboardRanked(env, request, id) {
  const t = await loadTest(env, id);
  const player = await getPlayer(env, request);
  const { results } = await env.DB.prepare(`SELECT p.id AS pid, p.nickname, a.score, a.total,
      (a.submitted_at - a.started_at) AS durationMs
    FROM ranked_attempts a JOIN players p ON p.id = a.player_id
    WHERE a.test_id = ? AND a.submitted_at IS NOT NULL AND p.hidden = 0 AND p.leaderboard_opt_out = 0
    ORDER BY a.score DESC, durationMs ASC LIMIT 100`).bind(id).all();
  return json({
    test: { id: t.id, title: t.title, status: testStatus(t, Date.now()) },
    youOptedOut: !!player?.leaderboard_opt_out,
    rows: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score, total: r.total, durationMs: r.durationMs, you: player?.id === r.pid })),
  });
}

async function leaderboardOverall(env, request) {
  const player = await getPlayer(env, request);
  const { results } = await env.DB.prepare(`SELECT p.id AS pid, p.nickname, SUM(a.score) AS points, COUNT(*) AS tests
    FROM ranked_attempts a JOIN players p ON p.id = a.player_id
    WHERE a.submitted_at IS NOT NULL AND p.hidden = 0 AND p.leaderboard_opt_out = 0
    GROUP BY p.id ORDER BY points DESC, tests ASC LIMIT 100`).all();
  return json({ youOptedOut: !!player?.leaderboard_opt_out, rows: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, points: r.points, tests: r.tests, you: player?.id === r.pid })) });
}

async function leaderboardPractice(env, request) {
  const player = await getPlayer(env, request);
  // Distinct questions answered correctly in the last 7 days — can't be farmed by repeating the same question.
  const { results } = await env.DB.prepare(`SELECT p.id AS pid, p.nickname, COUNT(DISTINCT pa.question_id) AS correct
    FROM practice_answers pa JOIN players p ON p.id = pa.player_id
    WHERE pa.correct = 1 AND pa.answered_at > ? AND p.hidden = 0 AND p.leaderboard_opt_out = 0
    GROUP BY p.id ORDER BY correct DESC LIMIT 100`).bind(Date.now() - 7 * 864e5).all();
  return json({ youOptedOut: !!player?.leaderboard_opt_out, rows: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, correct: r.correct, you: player?.id === r.pid })) });
}

// ---------- flags ----------

const FLAG_REASONS = {
  wrong_answer: 'Wrong answer marked correct',
  rationale: 'Rationale is wrong or unclear',
  unclear: 'Question is confusing or has a typo',
  not_in_slides: 'Not covered in our slides',
  other: 'Other',
};

async function createFlag(env, request) {
  const body = await readBody(request);
  const qid = parseInt(body.questionId, 10);
  const reason = String(body.reason || '');
  if (!FLAG_REASONS[reason]) throw new HttpError(400, 'Pick a reason');
  const comment = cleanText(body.comment, 500);
  const context = ['practice', 'ranked', 'review'].includes(body.context) ? body.context : '';
  const q = await env.DB.prepare('SELECT id FROM questions WHERE id = ?').bind(qid).first();
  if (!q) throw new HttpError(404, 'Question not found');
  const player = await getPlayer(env, request);
  if (player) {
    const dup = await env.DB.prepare("SELECT 1 FROM flags WHERE question_id = ? AND player_id = ? AND status = 'open'")
      .bind(qid, player.id).first();
    if (dup) throw new HttpError(409, "You've already flagged this question. Thanks, it's waiting for review.");
  }
  await env.DB.prepare('INSERT INTO flags (question_id, player_id, reason, comment, context, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(qid, player?.id ?? null, reason, comment, context, Date.now()).run();
  return json({ ok: true });
}

async function adminFlags(env, url) {
  const status = ['open', 'resolved', 'dismissed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'open';
  const { results } = await env.DB.prepare(`SELECT f.id, f.question_id, f.reason, f.comment, f.context, f.status, f.created_at, f.resolved_at,
      p.nickname, q.course, q.topic, q.stem, q.options, q.answer, q.rationale, q.source, q.status AS qstatus
    FROM flags f JOIN questions q ON q.id = f.question_id LEFT JOIN players p ON p.id = f.player_id
    WHERE f.status = ? ORDER BY f.created_at DESC LIMIT 1000`).bind(status).all();
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.question_id)) {
      groups.set(r.question_id, {
        question: { id: r.question_id, course: r.course, topic: r.topic, stem: r.stem, options: JSON.parse(r.options),
          answer: r.answer, rationale: r.rationale, source: r.source, status: r.qstatus },
        flags: [],
      });
    }
    groups.get(r.question_id).flags.push({ id: r.id, reason: r.reason, reasonLabel: FLAG_REASONS[r.reason] || r.reason,
      comment: r.comment, context: r.context, nickname: r.nickname, created_at: r.created_at, resolved_at: r.resolved_at });
  }
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM flags GROUP BY status').all();
  const list = [...groups.values()].sort((a, b) => b.flags.length - a.flags.length);
  return json({ status, groups: list, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])) });
}

async function adminResolveFlags(env, request) {
  const body = await readBody(request);
  const status = body.status === 'dismissed' ? 'dismissed' : body.status === 'open' ? 'open' : 'resolved';
  const now = Date.now();
  if (body.questionId != null) {
    const qid = parseInt(body.questionId, 10);
    const from = status === 'open' ? "status != 'open'" : "status = 'open'";
    const r = await env.DB.prepare(`UPDATE flags SET status = ?, resolved_at = ? WHERE question_id = ? AND ${from}`)
      .bind(status, status === 'open' ? null : now, qid).run();
    return json({ updated: r.meta.changes });
  }
  const ids = (body.ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  if (!ids.length) throw new HttpError(400, 'Nothing to update');
  const stmt = env.DB.prepare('UPDATE flags SET status = ?, resolved_at = ? WHERE id = ?');
  await env.DB.batch(ids.map((id) => stmt.bind(status, status === 'open' ? null : now, id)));
  return json({ updated: ids.length });
}

// ---------- admin ----------

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function requireAdmin(env, request) {
  const expected = String(env.ADMIN_KEY || '').trim();
  if (!expected) throw new HttpError(503, 'Admin is disabled: the ADMIN_KEY secret is not reaching the Worker');
  const key = (request.headers.get('x-admin-key') || '').trim();
  if (!timingSafeEqual(key, expected)) throw new HttpError(401, 'Wrong admin password');
}

function validateQuestion(raw, n) {
  const where = n != null ? `Question ${n}: ` : '';
  const course = cleanText(raw.course, 100);
  const topic = cleanText(raw.topic, 100) || 'General';
  const stem = cleanText(raw.stem ?? raw.question, 2000);
  const options = Array.isArray(raw.options) ? raw.options.map((o) => cleanText(o, 500)).filter(Boolean) : [];
  let answer = raw.answer;
  if (typeof answer === 'string' && /^[A-Fa-f]$/.test(answer.trim())) answer = answer.trim().toUpperCase().charCodeAt(0) - 65;
  answer = parseInt(answer, 10);
  const rationale = cleanText(raw.rationale, 3000);
  const source = cleanText(raw.source, 300);
  if (!course) throw new HttpError(400, `${where}missing course`);
  if (!stem) throw new HttpError(400, `${where}missing question text`);
  if (options.length < 2 || options.length > 6) throw new HttpError(400, `${where}needs 2–6 options`);
  if (!(answer >= 0 && answer < options.length)) throw new HttpError(400, `${where}answer must be the index (0-based) or letter of an option`);
  return { course, topic, stem, options, answer, rationale, source };
}

async function adminQuestions(env, request, url) {
  const status = url.searchParams.get('status');
  const course = url.searchParams.get('course');
  const q = url.searchParams.get('q');
  let sql = `SELECT q.*, (SELECT COUNT(*) FROM ranked_questions rq WHERE rq.question_id = q.id) AS inRanked,
      (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = q.id) AS answered,
      (SELECT SUM(correct) FROM practice_answers pa WHERE pa.question_id = q.id) AS answeredCorrect,
      (SELECT COUNT(*) FROM flags f WHERE f.question_id = q.id AND f.status = 'open') AS openFlags
    FROM questions q WHERE 1=1`;
  const b = [];
  if (status) { sql += ' AND q.status = ?'; b.push(status); }
  if (course) { sql += ' AND q.course = ?'; b.push(course); }
  if (q) { sql += ' AND (q.stem LIKE ? OR q.topic LIKE ? OR q.source LIKE ?)'; b.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY q.id DESC LIMIT 1000';
  const { results } = await env.DB.prepare(sql).bind(...b).all();
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM questions GROUP BY status').all();
  const courses = await env.DB.prepare('SELECT DISTINCT course FROM questions ORDER BY course').all();
  return json({
    questions: results.map((r) => ({ ...r, options: JSON.parse(r.options) })),
    counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])),
    courses: courses.results.map((c) => c.course),
  });
}

async function adminImport(env, request) {
  const body = await readBody(request);
  let list = Array.isArray(body) ? body : body.questions;
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Expected {"questions": [...]}');
  if (list.length > 500) throw new HttpError(400, 'Import at most 500 questions at a time');
  const defaults = { course: body.course, topic: body.topic, source: body.source };
  const status = body.status === 'approved' ? 'approved' : 'draft';
  const clean = list.map((raw, i) => validateQuestion({ ...defaults, ...raw, course: raw.course || defaults.course }, i + 1));
  const now = Date.now();
  const stmt = env.DB.prepare(`INSERT INTO questions (course, topic, stem, options, answer, rationale, source, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  await env.DB.batch(clean.map((q) => stmt.bind(q.course, q.topic, q.stem, JSON.stringify(q.options), q.answer, q.rationale, q.source, status, now, now)));
  return json({ imported: clean.length, status });
}

async function adminUpdateQuestion(env, request, id) {
  const body = await readBody(request);
  const existing = await env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(id).first();
  if (!existing) throw new HttpError(404, 'Question not found');
  const q = validateQuestion({ ...existing, options: JSON.parse(existing.options), ...body });
  const status = ['draft', 'approved', 'retired'].includes(body.status) ? body.status : existing.status;
  await env.DB.prepare(`UPDATE questions SET course=?, topic=?, stem=?, options=?, answer=?, rationale=?, source=?, status=?, updated_at=? WHERE id=?`)
    .bind(q.course, q.topic, q.stem, JSON.stringify(q.options), q.answer, q.rationale, q.source, status, Date.now(), id).run();
  return json({ ok: true });
}

async function adminBulkStatus(env, request) {
  const body = await readBody(request);
  const ids = (body.ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  if (!['draft', 'approved', 'retired'].includes(body.status)) throw new HttpError(400, 'Bad status');
  if (!ids.length) return json({ updated: 0 });
  const now = Date.now();
  const stmt = env.DB.prepare('UPDATE questions SET status = ?, updated_at = ? WHERE id = ?');
  await env.DB.batch(ids.map((id) => stmt.bind(body.status, now, id)));
  return json({ updated: ids.length });
}

async function adminDeleteQuestion(env, id) {
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM ranked_questions WHERE question_id = ?').bind(id).first();
  if (used.n) throw new HttpError(409, 'This question is part of a ranked test — retire it instead of deleting');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM practice_answers WHERE question_id = ?').bind(id),
    env.DB.prepare('DELETE FROM question_seen WHERE question_id = ?').bind(id),
    env.DB.prepare('DELETE FROM flags WHERE question_id = ?').bind(id),
    env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function adminRankedList(env) {
  const { results } = await env.DB.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM ranked_questions rq WHERE rq.test_id = t.id) AS questionCount,
      (SELECT COUNT(*) FROM ranked_attempts a WHERE a.test_id = t.id) AS attempts,
      (SELECT COUNT(*) FROM ranked_attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS submitted
    FROM ranked_tests t ORDER BY t.opens_at DESC`).all();
  const now = Date.now();
  return json({ tests: results.map((t) => ({ ...t, status: testStatus(t, now) })) });
}

async function adminRankedCreate(env, request) {
  const body = await readBody(request);
  const title = cleanText(body.title, 150);
  const course = cleanText(body.course, 100);
  const description = cleanText(body.description, 1000);
  const opens = Number(body.opens_at), closes = Number(body.closes_at);
  const ids = [...new Set((body.question_ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  if (!title || !course) throw new HttpError(400, 'Title and course are required');
  if (!(opens > 0 && closes > opens)) throw new HttpError(400, 'Close time must be after open time');
  if (ids.length < 1 || ids.length > 100) throw new HttpError(400, 'Pick 1–100 questions');
  const { results } = await env.DB.prepare(`SELECT id FROM questions WHERE status = 'approved' AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  if (results.length !== ids.length) throw new HttpError(400, 'Every question in a ranked test must be approved');
  const r = await env.DB.prepare('INSERT INTO ranked_tests (title, course, description, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(title, course, description, opens, closes, Date.now()).first();
  const stmt = env.DB.prepare('INSERT INTO ranked_questions (test_id, question_id, position) VALUES (?, ?, ?)');
  await env.DB.batch(ids.map((qid, i) => stmt.bind(r.id, qid, i)));
  return json({ id: r.id });
}

async function adminRankedUpdate(env, request, id) {
  const body = await readBody(request);
  const t = await loadTest(env, id);
  const title = cleanText(body.title ?? t.title, 150);
  const description = cleanText(body.description ?? t.description, 1000);
  const opens = Number(body.opens_at ?? t.opens_at), closes = Number(body.closes_at ?? t.closes_at);
  if (!(opens > 0 && closes > opens)) throw new HttpError(400, 'Close time must be after open time');
  await env.DB.prepare('UPDATE ranked_tests SET title=?, description=?, opens_at=?, closes_at=? WHERE id=?')
    .bind(title, description, opens, closes, id).run();
  return json({ ok: true });
}

async function adminRankedDelete(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ranked_attempts WHERE test_id = ?').bind(id),
    env.DB.prepare('DELETE FROM ranked_questions WHERE test_id = ?').bind(id),
    env.DB.prepare('DELETE FROM ranked_tests WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function adminRankedResults(env, id) {
  const t = await loadTest(env, id);
  const qs = await loadTestQuestions(env, id);
  const { results } = await env.DB.prepare(`SELECT a.id, a.started_at, a.submitted_at, a.score, a.total, a.answers,
      p.nickname, p.hidden, p.created_at AS playerCreated
    FROM ranked_attempts a JOIN players p ON p.id = a.player_id WHERE a.test_id = ?
    ORDER BY a.score DESC, (a.submitted_at - a.started_at) ASC`).bind(id).all();
  const right = {};
  let n = 0;
  for (const a of results) {
    if (!a.submitted_at) continue;
    n++;
    const ans = JSON.parse(a.answers || '{}');
    for (const q of qs) if (ans[q.id] === q.answer) right[q.id] = (right[q.id] || 0) + 1;
  }
  return json({
    test: { ...t, status: testStatus(t, Date.now()) },
    attempts: results.map(({ answers, ...a }) => a),
    questions: qs.map((q) => ({ id: q.id, topic: q.topic, stem: q.stem, percent: n ? Math.round((100 * (right[q.id] || 0)) / n) : null })),
  });
}

async function adminDeleteAttempt(env, id) {
  await env.DB.prepare('DELETE FROM ranked_attempts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function adminPlayers(env) {
  const { results } = await env.DB.prepare(`SELECT p.id, p.nickname, p.hidden, p.leaderboard_opt_out AS optedOut, p.created_at,
      (SELECT COUNT(*) FROM practice_answers pa WHERE pa.player_id = p.id) AS practiceAnswers,
      (SELECT COUNT(*) FROM ranked_attempts a WHERE a.player_id = p.id AND a.submitted_at IS NOT NULL) AS rankedTests,
      (SELECT MAX(answered_at) FROM practice_answers pa WHERE pa.player_id = p.id) AS lastPractice,
      (SELECT COUNT(*) FROM question_seen s WHERE s.player_id = p.id) AS questionsSeen
    FROM players p ORDER BY p.created_at DESC LIMIT 1000`).all();
  return json({ players: results });
}

async function adminUpdatePlayer(env, request, id) {
  const body = await readBody(request);
  const p = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Player not found');
  let nickname = p.nickname;
  if (body.nickname != null) {
    nickname = cleanText(body.nickname, 40).replace(/\s+/g, ' ');
    if (!NICK_RE.test(nickname)) throw new HttpError(400, 'Invalid nickname');
    const taken = await env.DB.prepare('SELECT 1 FROM players WHERE nickname_lc = ? AND id != ?').bind(nickname.toLowerCase(), id).first();
    if (taken) throw new HttpError(409, 'That nickname is taken');
  }
  const hidden = body.hidden != null ? (body.hidden ? 1 : 0) : p.hidden;
  await env.DB.prepare('UPDATE players SET nickname = ?, nickname_lc = ?, hidden = ? WHERE id = ?')
    .bind(nickname, nickname.toLowerCase(), hidden, id).run();
  return json({ ok: true });
}

// Permanently delete a player and their history. Their flags are kept but made anonymous.
async function adminDeletePlayer(env, id) {
  const p = await env.DB.prepare('SELECT id, nickname FROM players WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Player not found');
  return json(await deletePlayerData(env, p));
}

// Students can delete their own account; they must send confirm: "DELETE"
async function deleteSelf(env, request) {
  const p = await requirePlayer(env, request);
  const body = await readBody(request);
  if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
  return json(await deletePlayerData(env, p));
}

async function deletePlayerData(env, p) {
  const id = p.id;
  const [, practice, , attempts] = await env.DB.batch([
    env.DB.prepare('UPDATE flags SET player_id = NULL WHERE player_id = ?').bind(id),
    env.DB.prepare('DELETE FROM practice_answers WHERE player_id = ?').bind(id),
    env.DB.prepare('DELETE FROM question_seen WHERE player_id = ?').bind(id),
    env.DB.prepare('DELETE FROM ranked_attempts WHERE player_id = ?').bind(id),
    env.DB.prepare('DELETE FROM players WHERE id = ?').bind(id),
  ]);
  return { deleted: p.nickname, practiceAnswers: practice.meta.changes, rankedAttempts: attempts.meta.changes };
}

// ---------- router ----------

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  let x;

  if (path === '/api/players' && m === 'POST') return createPlayer(env, request);
  if (path === '/api/me' && m === 'GET') return me(env, request);
  if (path === '/api/me/settings' && m === 'POST') return updateSettings(env, request);
  if (path === '/api/me/delete' && m === 'POST') return deleteSelf(env, request);
  if (path === '/api/catalog' && m === 'GET') return catalog(env);
  if (path === '/api/practice/start' && m === 'POST') return practiceStart(env, request);
  if (path === '/api/practice/answer' && m === 'POST') return practiceAnswer(env, request);
  if (path === '/api/ranked' && m === 'GET') return rankedList(env, request);
  if ((x = path.match(/^\/api\/ranked\/(\d+)\/start$/)) && m === 'POST') return rankedStart(env, request, +x[1]);
  if ((x = path.match(/^\/api\/ranked\/(\d+)\/submit$/)) && m === 'POST') return rankedSubmit(env, request, +x[1]);
  if ((x = path.match(/^\/api\/ranked\/(\d+)\/review$/)) && m === 'GET') return rankedReview(env, request, +x[1]);
  if ((x = path.match(/^\/api\/leaderboard\/ranked\/(\d+)$/)) && m === 'GET') return leaderboardRanked(env, request, +x[1]);
  if (path === '/api/leaderboard/overall' && m === 'GET') return leaderboardOverall(env, request);
  if (path === '/api/leaderboard/practice' && m === 'GET') return leaderboardPractice(env, request);
  if (path === '/api/flags' && m === 'POST') return createFlag(env, request);

  // Public: says only whether an admin password is configured (never the password itself).
  if (path === '/api/admin/status' && m === 'GET') return json({ configured: !!String(env.ADMIN_KEY || '').trim() });

  if (path.startsWith('/api/admin')) {
    requireAdmin(env, request);
    if (path === '/api/admin/check') return json({ ok: true });
    if (path === '/api/admin/questions' && m === 'GET') return adminQuestions(env, request, url);
    if (path === '/api/admin/questions/import' && m === 'POST') return adminImport(env, request);
    if (path === '/api/admin/questions/status' && m === 'POST') return adminBulkStatus(env, request);
    if ((x = path.match(/^\/api\/admin\/questions\/(\d+)$/))) {
      if (m === 'PUT') return adminUpdateQuestion(env, request, +x[1]);
      if (m === 'DELETE') return adminDeleteQuestion(env, +x[1]);
    }
    if (path === '/api/admin/ranked' && m === 'GET') return adminRankedList(env);
    if (path === '/api/admin/ranked' && m === 'POST') return adminRankedCreate(env, request);
    if ((x = path.match(/^\/api\/admin\/ranked\/(\d+)$/))) {
      if (m === 'PUT') return adminRankedUpdate(env, request, +x[1]);
      if (m === 'DELETE') return adminRankedDelete(env, +x[1]);
    }
    if ((x = path.match(/^\/api\/admin\/ranked\/(\d+)\/results$/)) && m === 'GET') return adminRankedResults(env, +x[1]);
    if ((x = path.match(/^\/api\/admin\/attempts\/(\d+)$/)) && m === 'DELETE') return adminDeleteAttempt(env, +x[1]);
    if (path === '/api/admin/flags' && m === 'GET') return adminFlags(env, url);
    if (path === '/api/admin/flags/resolve' && m === 'POST') return adminResolveFlags(env, request);
    if (path === '/api/admin/players' && m === 'GET') return adminPlayers(env);
    if ((x = path.match(/^\/api\/admin\/players\/([\w-]+)$/))) {
      if (m === 'PUT') return adminUpdatePlayer(env, request, x[1]);
      if (m === 'DELETE') return adminDeletePlayer(env, x[1]);
    }
  }
  return fail('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error(e);
      return fail('Server error', 500);
    }
  },
};
