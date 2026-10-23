// PN Practice — student app (no framework; hash routing)
(() => {
  const app = document.getElementById('app');
  const LS_CODE = 'pn_code', LS_NICK = 'pn_nick';

  // ---------- utils ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (i) => String.fromCharCode(65 + i);
  const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDur = (ms) => {
    if (ms == null) return '';
    const s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    const code = store.get(LS_CODE);
    if (code) headers['x-player-code'] = code;
    const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const html = (s) => { app.innerHTML = s; window.scrollTo(0, 0); };
  const errorBox = (e) => `<div class="notice error">${esc(e.message || e)}</div>`;
  const hasCode = () => !!store.get(LS_CODE);

  // A test in progress sets this so leaving the page asks first.
  let leaveGuard = null;
  window.addEventListener('beforeunload', (e) => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- router ----------
  const routes = [
    [/^\/?$/, home],
    [/^\/welcome$/, welcome],
    [/^\/practice\/(.+)$/, (m) => practiceSetup(decodeURIComponent(m[1]))],
    [/^\/ranked\/(\d+)$/, (m) => rankedIntro(+m[1])],
    [/^\/review\/(\d+)$/, (m) => rankedReview(+m[1])],
    [/^\/leaderboard(?:\/(\w+))?$/, (m) => leaderboard(m[1])],
    [/^\/me$/, mePage],
  ];
  let lastHash = location.hash;
  async function router() {
    if (leaveGuard && !confirm(leaveGuard)) { history.replaceState(null, '', lastHash || '#/'); return; }
    leaveGuard = null;
    lastHash = location.hash;
    const path = location.hash.replace(/^#/, '') || '/';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const n = a.dataset.nav;
      a.classList.toggle('active', (n === 'home' && (path === '/' || path.startsWith('/practice') || path.startsWith('/ranked'))) || path.startsWith('/' + n));
    });
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try { await fn(m); } catch (e) { html(errorBox(e)); }
        return;
      }
    }
    location.hash = '#/';
  }

  // ---------- flag a question ----------
  const FLAG_REASONS = [
    ['wrong_answer', 'Wrong answer marked correct'],
    ['rationale', 'Rationale is wrong or unclear'],
    ['unclear', 'Question is confusing or has a typo'],
    ['not_in_slides', 'Not covered in our slides'],
    ['other', 'Other'],
  ];
  function flagWidget(qid, context) {
    return `<div class="flag" data-qid="${qid}" data-context="${context}"><button type="button" class="linkbtn" data-flag-open>⚑ Flag this question</button></div>`;
  }
  document.addEventListener('click', async (e) => {
    const box = e.target.closest('.flag');
    if (!box) return;
    const qid = box.dataset.qid;
    if (e.target.closest('[data-flag-open]')) {
      box.innerHTML = `<div class="flagform">
        <div class="small" style="font-weight:600;margin-bottom:4px">What's wrong with this question?</div>
        ${FLAG_REASONS.map(([k, label]) => `<label class="check small"><input type="radio" name="fr-${qid}" value="${k}"> ${label}</label>`).join('')}
        <textarea class="small" maxlength="500" placeholder="Optional: what should it say? (e.g. slide 24 says…)"></textarea>
        <div class="fmsg"></div>
        <div class="row"><button type="button" class="small" data-flag-send>Send</button><button type="button" class="small ghost" data-flag-cancel>Cancel</button></div>
      </div>`;
      return;
    }
    if (e.target.closest('[data-flag-cancel]')) { box.innerHTML = flagWidget(qid, box.dataset.context).replace(/^<div[^>]*>|<\/div>$/g, ''); return; }
    const send = e.target.closest('[data-flag-send]');
    if (send) {
      const reason = box.querySelector(`input[name="fr-${qid}"]:checked`)?.value;
      const msg = box.querySelector('.fmsg');
      if (!reason) { msg.innerHTML = '<div class="notice error small">Pick a reason</div>'; return; }
      send.disabled = true;
      try {
        await api('/api/flags', { method: 'POST', body: { questionId: +qid, reason, comment: box.querySelector('textarea').value, context: box.dataset.context } });
        box.innerHTML = '<div class="small" style="color:var(--good)">⚑ Thanks, an admin will review this question.</div>';
      } catch (err) {
        if (err.status === 409) box.innerHTML = `<div class="small muted">${esc(err.message)}</div>`;
        else { msg.innerHTML = errorBox(err); send.disabled = false; }
      }
    }
  });

  window.addEventListener('hashchange', router);

  // ---------- welcome / study code ----------
  function welcome() {
    html(`
      <h1>Welcome</h1>
      <p class="muted">Practice tests and ranked quizzes for Practical Nursing students. No account or email needed. Pick a nickname and you'll get a study code that keeps your progress.</p>
      <div class="card">
        <h2 style="margin-top:0">New here?</h2>
        <form id="newForm">
          <label class="field"><span>Nickname (shown on leaderboards, don't use your full name)</span>
            <input type="text" id="nick" maxlength="20" autocomplete="off" required></label>
          <div id="newMsg"></div>
          <button type="submit">Get my study code</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Already have a code?</h2>
        <form id="oldForm">
          <label class="field"><span>Study code</span>
            <input type="text" id="code" placeholder="OTTER-7KQ3M" autocomplete="off" autocapitalize="characters" required></label>
          <div id="oldMsg"></div>
          <button type="submit" class="secondary">Use this code</button>
        </form>
      </div>
      <p class="small muted">Just browsing? <a href="#/" id="skip">Try practice without a code</a>. Your results won't be saved or count toward leaderboards.</p>`);
    document.getElementById('skip').onclick = () => store.set('pn_skip', '1');
    document.getElementById('newForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await api('/api/players', { method: 'POST', body: { nickname: document.getElementById('nick').value } });
        store.set(LS_CODE, r.code); store.set(LS_NICK, r.nickname);
        showNewCode(r);
      } catch (err) {
        document.getElementById('newMsg').innerHTML = errorBox(err); btn.disabled = false;
      }
    };
    document.getElementById('oldForm').onsubmit = async (e) => {
      e.preventDefault();
      const code = document.getElementById('code').value.trim().toUpperCase();
      store.set(LS_CODE, code);
      try {
        const r = await api('/api/me');
        store.set(LS_NICK, r.nickname);
        location.hash = '#/';
      } catch (err) {
        store.del(LS_CODE);
        document.getElementById('oldMsg').innerHTML = errorBox(err.status === 401 ? 'That code wasn\'t found. Check for typos.' : err);
      }
    };
  }
  function showNewCode(r) {
    html(`
      <h1>You're in, ${esc(r.nickname)}</h1>
      <p>This is your study code. It's saved on this device, but <strong>write it down or screenshot it</strong>. You'll need it to use another device or if your browser data gets cleared.</p>
      <div class="code-box">${esc(r.code)}</div>
      <div class="row"><button id="copy" class="secondary">Copy code</button><a class="btn" href="#/">Continue</a></div>
      <p class="small muted" style="margin-top:12px">Anyone with this code can use your nickname, so keep it to yourself.</p>`);
    document.getElementById('copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(r.code); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed. Write it down.'; }
    };
  }

  // ---------- home ----------
  async function home() {
    if (!hasCode() && !store.get('pn_skip')) { location.hash = '#/welcome'; return; }
    html('<p class="muted">Loading…</p>');
    const [cat, ranked] = await Promise.all([api('/api/catalog'), api('/api/ranked')]);
    const nick = store.get(LS_NICK);
    const open = ranked.tests.filter((t) => t.status === 'open');
    const upcoming = ranked.tests.filter((t) => t.status === 'upcoming');
    const closed = ranked.tests.filter((t) => t.status === 'closed').slice(0, 6);

    const rankedCard = (t) => {
      let action = '';
      if (t.status === 'open') {
        if (t.attempt?.submitted) action = `<span class="small">You scored <strong>${t.attempt.score}/${t.attempt.total}</strong></span> <a class="btn small secondary" href="#/leaderboard/test${t.id}">Leaderboard</a>`;
        else if (t.attempt) action = `<a class="btn small" href="#/ranked/${t.id}">Resume</a>`;
        else action = `<a class="btn small" href="#/ranked/${t.id}">Start</a>`;
      } else if (t.status === 'closed') {
        action = `<a class="btn small secondary" href="#/review/${t.id}">Review answers</a> <a class="btn small secondary" href="#/leaderboard/test${t.id}">Leaderboard</a>`;
      }
      const when = t.status === 'upcoming' ? `Opens ${fmtDate(t.opens_at)}` : t.status === 'open' ? `Closes ${fmtDate(t.closes_at)}` : `Closed ${fmtDate(t.closes_at)}`;
      return `<div class="card">
        <div class="row"><strong>${esc(t.title)}</strong><span class="pill ${t.status}">${t.status}</span></div>
        <div class="small muted">${esc(t.course)} · ${t.questionCount} questions · ${when} · ${t.takers} taken</div>
        ${t.description ? `<p class="small" style="margin:6px 0 0">${esc(t.description)}</p>` : ''}
        ${action ? `<div class="row" style="margin-top:10px">${action}</div>` : ''}
      </div>`;
    };

    html(`
      <h1>${nick ? `Hi, ${esc(nick)}` : 'PN Practice'}</h1>
      ${!hasCode() ? `<div class="notice small">You're practising without a study code, so results aren't saved. <a href="#/welcome">Get a code</a></div>` : ''}
      <h2>Practice</h2>
      <p class="small muted">Unlimited attempts, a new mix of questions each time, and instant feedback.</p>
      ${cat.courses.length ? cat.courses.map((c) => `
        <a class="card row" style="text-decoration:none;color:inherit" href="#/practice/${encodeURIComponent(c.course)}">
          <div><strong>${esc(c.course)}</strong><div class="small muted">${c.total} questions · ${c.topics.length} topic${c.topics.length === 1 ? '' : 's'}</div></div>
          <span class="spacer"></span><span class="btn small">Practise</span>
        </a>`).join('') : '<div class="card empty">No practice questions yet.</div>'}
      <h2>Ranked tests</h2>
      <p class="small muted">One attempt. Everyone gets the same questions. Answers unlock when the test closes.</p>
      ${open.length ? open.map(rankedCard).join('') : '<div class="card empty">No ranked tests open right now.</div>'}
      ${upcoming.length ? `<h2>Coming up</h2>${upcoming.map(rankedCard).join('')}` : ''}
      ${closed.length ? `<h2>Recently closed</h2>${closed.map(rankedCard).join('')}` : ''}
    `);
  }

  // ---------- practice ----------
  async function practiceSetup(course) {
    const cat = await api('/api/catalog');
    const c = cat.courses.find((x) => x.course === course);
    if (!c) { html(`<div class="notice">No practice questions for ${esc(course)} yet.</div><a href="#/">Back</a>`); return; }
    html(`
      <p class="small"><a href="#/">← Home</a></p>
      <h1>${esc(course)} practice</h1>
      <div class="card">
        <strong>Topics</strong>
        <div class="row small" style="margin:4px 0"><a href="#" id="all">All</a> · <a href="#" id="none">None</a></div>
        <div id="topics">${c.topics.map((t) => `<label class="check"><input type="checkbox" value="${esc(t.topic)}" checked> ${esc(t.topic)} <span class="muted small">(${t.n})</span></label>`).join('')}</div>
        <label class="field" style="margin-top:12px"><span>Number of questions</span>
          <select id="count">${[5, 10, 20, 30].map((n) => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div id="msg"></div>
        <button id="go">Start practice</button>
      </div>`);
    const boxes = () => [...document.querySelectorAll('#topics input')];
    document.getElementById('all').onclick = (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = true)); };
    document.getElementById('none').onclick = (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = false)); };
    document.getElementById('go').onclick = async () => {
      const topics = boxes().filter((b) => b.checked).map((b) => b.value);
      if (!topics.length) { document.getElementById('msg').innerHTML = errorBox('Pick at least one topic'); return; }
      try {
        const r = await api('/api/practice/start', { method: 'POST', body: { course, topics, count: +document.getElementById('count').value } });
        runPractice(course, topics, r.questions);
      } catch (e) { document.getElementById('msg').innerHTML = errorBox(e); }
    };
  }

  function runPractice(course, topics, questions) {
    const results = []; // {q, choice, correct, answer, rationale}
    let i = 0;
    const show = () => {
      const q = questions[i];
      html(`
        <div class="row small muted"><span>${esc(course)} · ${esc(q.topic)}</span><span class="spacer"></span><span>${i + 1} / ${questions.length}</span></div>
        <div class="progress"><div style="width:${pct(i, questions.length)}%"></div></div>
        <div class="card">
          <div class="stem">${esc(q.stem)}</div>
          <div class="options">${q.options.map((o, k) => `<button class="option" data-i="${o.i}"><span class="letter">${L(k)}</span><span>${esc(o.text)}</span></button>`).join('')}</div>
          <div id="fb"></div>
        </div>
        <div class="row"><a href="#/" class="small">Quit</a><span class="spacer"></span><button id="next" style="display:none">${i + 1 === questions.length ? 'See results' : 'Next'}</button></div>`);
      document.querySelectorAll('.option').forEach((btn) => {
        btn.onclick = async () => {
          const choice = +btn.dataset.i;
          document.querySelectorAll('.option').forEach((b) => (b.disabled = true));
          btn.classList.add('selected');
          try {
            const r = await api('/api/practice/answer', { method: 'POST', body: { questionId: q.id, choice } });
            results.push({ q, choice, ...r });
            document.querySelectorAll('.option').forEach((b) => {
              const bi = +b.dataset.i;
              if (bi === r.answer) b.classList.add('correct');
              else if (bi === choice) b.classList.add('wrong');
            });
            document.getElementById('fb').innerHTML = `<div class="rationale"><div class="verdict" style="color:var(--${r.correct ? 'good' : 'bad'})">${r.correct ? 'Correct' : 'Not quite'}</div>${esc(r.rationale || '')}${r.source ? `<div class="small muted" style="margin-top:6px">Source: ${esc(r.source)}</div>` : ''}</div>` + flagWidget(q.id, 'practice');
            document.getElementById('next').style.display = '';
          } catch (e) {
            document.getElementById('fb').innerHTML = errorBox(e);
            document.querySelectorAll('.option').forEach((b) => (b.disabled = false));
            btn.classList.remove('selected');
          }
        };
      });
      document.getElementById('next').onclick = () => { i++; i < questions.length ? show() : finish(); };
    };
    const finish = () => {
      const right = results.filter((r) => r.correct).length;
      const missed = results.filter((r) => !r.correct);
      html(`
        <h1>Practice complete</h1>
        <div class="card" style="text-align:center">
          <div class="big-score">${right} / ${results.length}</div>
          <div class="muted">${pct(right, results.length)}% correct</div>
        </div>
        <div class="row" style="margin-bottom:12px"><button id="again">Practise again</button><a class="btn secondary" href="#/">Home</a></div>
        ${missed.length ? `<h2>Review what you missed</h2>${missed.map((r) => {
          const opts = r.q.options.slice().sort((a, b) => a.i - b.i);
          return `<div class="card"><div class="stem" style="font-size:1rem">${esc(r.q.stem)}</div>
            <div class="small">Your answer: <span style="color:var(--bad)">${esc(opts.find((o) => o.i === r.choice)?.text)}</span></div>
            <div class="small">Correct: <span style="color:var(--good)">${esc(opts.find((o) => o.i === r.answer)?.text)}</span></div>
            <div class="rationale small">${esc(r.rationale)}</div></div>`;
        }).join('')}` : '<div class="notice good">Perfect round!</div>'}`);
      document.getElementById('again').onclick = async () => {
        try {
          const r = await api('/api/practice/start', { method: 'POST', body: { course, topics, count: questions.length } });
          runPractice(course, topics, r.questions);
        } catch (e) { html(errorBox(e)); }
      };
    };
    show();
  }

  // ---------- ranked ----------
  async function rankedIntro(id) {
    if (!hasCode()) {
      html(`<div class="notice">Ranked tests need a study code so your score can go on the leaderboard.</div><a class="btn" href="#/welcome">Get a code</a>`);
      return;
    }
    const list = await api('/api/ranked');
    const t = list.tests.find((x) => x.id === id);
    if (!t) throw new Error('Test not found');
    if (t.status !== 'open') { location.hash = t.status === 'closed' ? `#/review/${id}` : '#/'; return; }
    if (t.attempt?.submitted) { location.hash = `#/leaderboard/test${id}`; return; }
    if (t.attempt) return startRanked(id);
    html(`
      <p class="small"><a href="#/">← Home</a></p>
      <h1>${esc(t.title)}</h1>
      <div class="card stack">
        <div class="small muted">${esc(t.course)} · ${t.questionCount} questions · closes ${fmtDate(t.closes_at)}</div>
        ${t.description ? `<p>${esc(t.description)}</p>` : ''}
        <div class="notice small"><strong>One attempt only.</strong> Your time starts when you press Start and counts as the tiebreaker. You'll see your score right away; correct answers unlock for everyone when the test closes.</div>
        <button id="start">Start test</button>
      </div>`);
    document.getElementById('start').onclick = () => startRanked(id);
  }

  async function startRanked(id) {
    const r = await api(`/api/ranked/${id}/start`, { method: 'POST' });
    const key = `pn_ranked_${id}`;
    let saved = {};
    try { saved = JSON.parse(store.get(key) || '{}'); } catch {}
    const answers = saved.answers || {};
    const order = saved.order || {};
    // keep option order stable across refreshes
    r.questions.forEach((q) => {
      if (order[q.id]) q.options.sort((a, b) => order[q.id].indexOf(a.i) - order[q.id].indexOf(b.i));
      else order[q.id] = q.options.map((o) => o.i);
    });
    const save = () => store.set(key, JSON.stringify({ answers, order }));
    save();
    const qs = r.questions;
    let i = 0, timer = null;
    leaveGuard = 'Leave this ranked test? Your progress is saved and the clock keeps running.';

    const answeredCount = () => qs.filter((q) => answers[q.id] != null).length;
    const tick = () => { const el = document.getElementById('clock'); if (el) el.textContent = fmtDur(Date.now() - r.startedAt); };
    const show = () => {
      const q = qs[i];
      html(`
        <div class="row small muted"><strong style="color:var(--text)">${esc(r.test.title)}</strong><span class="spacer"></span><span>⏱ <span id="clock"></span></span></div>
        <div class="progress"><div style="width:${pct(answeredCount(), qs.length)}%"></div></div>
        ${r.resumed && i === 0 ? '<div class="notice small">Resumed where you left off. The clock kept running.</div>' : ''}
        <div class="card">
          <div class="small muted" style="margin-bottom:6px">Question ${i + 1} of ${qs.length}</div>
          <div class="stem">${esc(q.stem)}</div>
          <div class="options">${q.options.map((o, k) => `<button class="option ${answers[q.id] === o.i ? 'selected' : ''}" data-i="${o.i}"><span class="letter">${L(k)}</span><span>${esc(o.text)}</span></button>`).join('')}</div>
          ${flagWidget(q.id, 'ranked')}
        </div>
        <div class="row"><button class="ghost" id="prev" ${i === 0 ? 'disabled' : ''}>Back</button><span class="spacer"></span>
          ${i + 1 < qs.length ? '<button id="next">Next</button>' : '<button id="finish">Review &amp; submit</button>'}</div>
        <div class="qnav">${qs.map((x, k) => `<button class="${answers[x.id] != null ? 'answered' : ''} ${k === i ? 'current' : ''}" data-k="${k}">${k + 1}</button>`).join('')}</div>`);
      tick();
      document.querySelectorAll('.option').forEach((b) => {
        b.onclick = () => {
          answers[q.id] = +b.dataset.i; save();
          document.querySelectorAll('.option').forEach((x) => x.classList.toggle('selected', x === b));
          document.querySelectorAll('.qnav button')[i].classList.add('answered');
          document.querySelector('.progress > div').style.width = pct(answeredCount(), qs.length) + '%';
        };
      });
      document.getElementById('prev').onclick = () => { i--; show(); };
      const nx = document.getElementById('next'); if (nx) nx.onclick = () => { i++; show(); };
      const fin = document.getElementById('finish'); if (fin) fin.onclick = confirmSubmit;
      document.querySelectorAll('.qnav button').forEach((b) => (b.onclick = () => { i = +b.dataset.k; show(); }));
    };
    const confirmSubmit = () => {
      const missing = qs.length - answeredCount();
      html(`
        <h1>Submit ${esc(r.test.title)}?</h1>
        <div class="card stack">
          <p>You've answered <strong>${answeredCount()} of ${qs.length}</strong>.${missing ? ` <span style="color:var(--bad)">${missing} unanswered will be marked wrong.</span>` : ''}</p>
          <p class="small muted">You can't change answers after submitting.</p>
          <div id="msg"></div>
          <div class="row"><button class="ghost" id="back">Go back</button><button id="submit">Submit</button></div>
        </div>
        <div class="qnav">${qs.map((x, k) => `<button class="${answers[x.id] != null ? 'answered' : ''}" data-k="${k}">${k + 1}</button>`).join('')}</div>`);
      document.getElementById('back').onclick = show;
      document.querySelectorAll('.qnav button').forEach((b) => (b.onclick = () => { i = +b.dataset.k; show(); }));
      document.getElementById('submit').onclick = async (e) => {
        e.target.disabled = true;
        try {
          const res = await api(`/api/ranked/${id}/submit`, { method: 'POST', body: { answers } });
          clearInterval(timer); leaveGuard = null; store.del(key);
          html(`
            <h1>Submitted</h1>
            <div class="card" style="text-align:center">
              <div class="big-score">${res.score} / ${res.total}</div>
              <div>${pct(res.score, res.total)}% · ${fmtDur(res.durationMs)} · currently <strong>#${res.rank}</strong></div>
            </div>
            <p class="small muted">Correct answers and rationales unlock when the test closes on ${fmtDate(res.closes_at)}.</p>
            <div class="row"><a class="btn" href="#/leaderboard/test${id}">See leaderboard</a><a class="btn secondary" href="#/">Home</a></div>`);
        } catch (err) {
          document.getElementById('msg').innerHTML = errorBox(err); e.target.disabled = false;
        }
      };
    };
    timer = setInterval(tick, 1000);
    const stop = () => { if (!leaveGuard) { clearInterval(timer); window.removeEventListener('hashchange', stop); } };
    window.addEventListener('hashchange', stop);
    show();
  }

  async function rankedReview(id) {
    let r;
    try { r = await api(`/api/ranked/${id}/review`); }
    catch (e) { html(`${errorBox(e)}<a href="#/">Home</a>`); return; }
    const mine = r.questions.filter((q) => q.yourChoice != null);
    const right = r.questions.filter((q) => q.yourChoice === q.answer).length;
    html(`
      <p class="small"><a href="#/">← Home</a></p>
      <h1>${esc(r.test.title)}: review</h1>
      <p class="muted small">${r.takers} student${r.takers === 1 ? '' : 's'} took this test.${mine.length ? ` You got <strong>${right}/${r.questions.length}</strong>.` : ''} The percentage shows how much of the class got each question right.</p>
      ${r.questions.map((q, n) => `<div class="card">
        <div class="row small muted"><span>Q${n + 1} · ${esc(q.topic)}</span><span class="spacer"></span>${q.classPercent != null ? `<span>${q.classPercent}% of class correct</span>` : ''}</div>
        <div class="stem" style="margin-top:4px">${esc(q.stem)}</div>
        <div class="options">${q.options.map((o, k) => `<div class="option ${k === q.answer ? 'correct' : k === q.yourChoice ? 'wrong' : ''}"><span class="letter">${L(k)}</span><span>${esc(o)}${k === q.yourChoice ? ' <em class="small">(your answer)</em>' : ''}</span></div>`).join('')}</div>
        <div class="rationale small">${esc(q.rationale)}${q.source ? `<div class="muted" style="margin-top:4px">Source: ${esc(q.source)}</div>` : ''}</div>
        ${flagWidget(q.id, 'review')}
      </div>`).join('')}`);
  }

  // ---------- leaderboard ----------
  async function leaderboard(which) {
    which = which || 'overall';
    const ranked = await api('/api/ranked');
    const tests = ranked.tests.filter((t) => t.status !== 'upcoming');
    const tabs = [['overall', 'Ranked overall'], ['practice', 'Practice this week'], ...tests.slice(0, 8).map((t) => [`test${t.id}`, t.title])];
    html(`
      <h1>Leaderboard</h1>
      <div class="tabs">${tabs.map(([k, label]) => `<button data-k="${k}" class="${k === which ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>
      <div id="board" class="card"><p class="muted">Loading…</p></div>`);
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => (location.hash = `#/leaderboard/${b.dataset.k}`)));
    const board = document.getElementById('board');
    const table = (head, rows) => rows.length
      ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<div class="empty">No one on the board yet. Be the first!</div>';
    if (which === 'overall') {
      const r = await api('/api/leaderboard/overall');
      board.innerHTML = `<p class="small muted">Total correct answers across all ranked tests.</p>` + table('<th>#</th><th>Nickname</th><th class="num">Points</th><th class="num">Tests</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.points}</td><td class="num">${x.tests}</td></tr>`));
    } else if (which === 'practice') {
      const r = await api('/api/leaderboard/practice');
      board.innerHTML = `<p class="small muted">Different questions answered correctly in practice over the last 7 days.</p>` + table('<th>#</th><th>Nickname</th><th class="num">Correct</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.correct}</td></tr>`));
    } else {
      const id = +which.replace('test', '');
      const r = await api(`/api/leaderboard/ranked/${id}`);
      board.innerHTML = `<p class="small muted">Highest score wins; fastest time breaks ties.${r.test.status === 'closed' ? ` <a href="#/review/${id}">Review answers</a>` : ''}</p>` + table('<th>#</th><th>Nickname</th><th class="num">Score</th><th class="num">Time</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.score}/${x.total}</td><td class="num">${fmtDur(x.durationMs)}</td></tr>`));
    }
  }

  // ---------- me ----------
  async function mePage() {
    if (!hasCode()) { location.hash = '#/welcome'; return; }
    let r;
    try { r = await api('/api/me'); }
    catch (e) {
      if (e.status === 401) { store.del(LS_CODE); location.hash = '#/welcome'; return; }
      throw e;
    }
    const code = store.get(LS_CODE);
    html(`
      <h1>${esc(r.nickname)}</h1>
      ${r.hidden ? '<div class="notice small">An admin has hidden you from leaderboards.</div>' : ''}
      <div class="card">
        <strong>Your study code</strong>
        <p class="small muted" style="margin:4px 0 0">Use it to sign in on another device. Keep it private.</p>
        <div class="code-box" id="codeBox">••••••••••</div>
        <div class="row"><button class="secondary small" id="reveal">Show</button><button class="secondary small" id="copy">Copy</button></div>
      </div>
      <h2>Practice</h2>
      <div class="card">
        <p class="small muted">${r.weeklyCorrect} different questions answered correctly in the last 7 days.</p>
        ${r.practice.length ? `<table><thead><tr><th>Course</th><th class="num">Answered</th><th class="num">Correct</th></tr></thead><tbody>
          ${r.practice.map((p) => `<tr><td>${esc(p.course)}</td><td class="num">${p.answered}</td><td class="num">${pct(p.correct, p.answered)}%</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">No practice yet.</div>'}
      </div>
      <h2>Ranked tests</h2>
      <div class="card">
        ${r.ranked.length ? `<table><thead><tr><th>Test</th><th class="num">Score</th></tr></thead><tbody>
          ${r.ranked.map((t) => `<tr><td><a href="#/leaderboard/test${t.id}">${esc(t.title)}</a></td><td class="num">${t.score}/${t.total}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">No ranked tests taken yet.</div>'}
      </div>
      <p class="small"><a href="#" id="signout">Sign out on this device</a></p>`);
    let shown = false;
    document.getElementById('reveal').onclick = (e) => {
      shown = !shown;
      document.getElementById('codeBox').textContent = shown ? code : '••••••••••';
      e.target.textContent = shown ? 'Hide' : 'Show';
    };
    document.getElementById('copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(code); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    };
    document.getElementById('signout').onclick = (e) => {
      e.preventDefault();
      if (!confirm(`Sign out? You'll need your code (${code}) to get back in.`)) return;
      store.del(LS_CODE); store.del(LS_NICK); store.del('pn_skip');
      location.hash = '#/welcome';
    };
  }

  router();
})();
