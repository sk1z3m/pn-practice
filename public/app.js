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
    [/^\/practice\/([^/]+)\/(.+)$/, (m) => practiceSetup(decodeURIComponent(m[1]), decodeURIComponent(m[2]))],
    [/^\/practice\/(.+)$/, (m) => practiceSetup(decodeURIComponent(m[1]))],
    [/^\/ranked\/(\d+)$/, (m) => rankedIntro(+m[1])],
    [/^\/review\/(\d+)$/, (m) => rankedReview(+m[1])],
    [/^\/leaderboard(?:\/(\w+))?$/, (m) => leaderboard(m[1])],
    [/^\/(?:profile|me)$/, mePage],
    [/^\/updates$/, updatesPage],
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
    const [cat, ranked, me] = await Promise.all([api('/api/catalog'), api('/api/ranked'), hasCode() ? api('/api/me').catch(() => null) : null]);
    if (me) { store.set(LS_NICK, me.nickname); setUpdateBadge(me.unreadUpdates); }
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
      ${me && me.unreadUpdates ? `<a class="notice update-note" href="#/updates">🔔 <strong>${me.unreadUpdates} question${me.unreadUpdates === 1 ? '' : 's'} you've answered ${me.unreadUpdates === 1 ? 'was' : 'were'} corrected.</strong> <span>See what changed →</span></a>` : ''}
      ${!hasCode() ? `<div class="notice small">You're practising without a study code, so results aren't saved. <a href="#/welcome">Get a code</a></div>` : ''}
      <h2>Practice</h2>
      <p class="small muted">Unlimited attempts, a new mix of questions each time, and instant feedback.</p>
      ${cat.courses.length ? cat.courses.map((c) => `
        <div class="card">
          <a class="row" style="text-decoration:none;color:inherit" href="#/practice/${encodeURIComponent(c.course)}">
            <div><strong>${esc(c.course)}</strong><div class="small muted">${c.total} questions · ${c.topics.length} topic${c.topics.length === 1 ? '' : 's'}</div></div>
            <span class="spacer"></span><span class="btn small">Practise</span>
          </a>
          ${c.groups.length ? `<div class="group-links">${c.groups.map((g) => `<a class="chip" href="#/practice/${encodeURIComponent(c.course)}/${encodeURIComponent(g.name)}">${esc(g.name)}</a>`).join('')}</div>` : ''}
        </div>`).join('') : '<div class="card empty">No practice questions yet.</div>'}
      <h2>Ranked tests</h2>
      <p class="small muted">One attempt. Everyone gets the same questions. Answers unlock when the test closes.</p>
      ${open.length ? open.map(rankedCard).join('') : '<div class="card empty">No ranked tests open right now.</div>'}
      ${upcoming.length ? `<h2>Coming up</h2>${upcoming.map(rankedCard).join('')}` : ''}
      ${closed.length ? `<h2>Recently closed</h2>${closed.map(rankedCard).join('')}` : ''}
    `);
    if (me && !me.lbPrompted && !document.querySelector('.modal-back')) leaderboardWindow();
  }

  // ---------- leaderboard explainer (shown once per study code) ----------
  function leaderboardWindow() {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="lbTitle">
      <h2 id="lbTitle" style="margin-top:0">About the leaderboards</h2>
      <p>PN Practice has leaderboards to make studying a little competitive:</p>
      <ul class="small" style="margin:0 0 12px;padding-left:20px">
        <li><strong>Ranked tests:</strong> your score and time on each test</li>
        <li><strong>Ranked overall:</strong> total points across all ranked tests</li>
        <li><strong>Practice this week:</strong> questions you've answered correctly in practice</li>
      </ul>
      <p class="small">If you stay on, your <strong>nickname</strong> and scores are visible to other students. If you opt out, you can still use everything (practice, ranked tests, your own scores in <strong>Profile</strong>), but your nickname won't appear on any leaderboard.</p>
      <p class="small muted">You can change this any time in the <strong>Profile</strong> tab.</p>
      <div class="msg"></div>
      <div class="modal-actions">
        <button class="secondary" data-lb="out">Opt out of leaderboards</button>
        <button data-lb="in">Stay on leaderboards</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-lb="in"]').focus();
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lb]'); if (!b) return;
      wrap.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        await api('/api/me/settings', { method: 'POST', body: { onLeaderboard: b.dataset.lb === 'in', lbPrompted: true } });
        wrap.remove();
        if (b.dataset.lb === 'out') toast('You\'re off the leaderboards. Change this any time in Profile.');
      } catch (err) {
        wrap.querySelector('.msg').innerHTML = errorBox(err);
        wrap.querySelectorAll('button').forEach((x) => (x.disabled = false));
      }
    });
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- practice ----------
  // Without a study code, the server can't remember what was served, so the browser keeps the list.
  const LS_SEEN = 'pn_seen';
  const MAX_Q = 100; // largest practice round
  function deviceSeen() { try { return JSON.parse(store.get(LS_SEEN) || '[]'); } catch { return []; } }
  function rememberSeen(ids) {
    if (hasCode()) return;
    const list = deviceSeen().filter((x) => !ids.includes(x)).concat(ids).slice(-2000);
    store.set(LS_SEEN, JSON.stringify(list));
  }
  async function startPractice(course, topics, count) {
    const body = { course, topics, count };
    if (!hasCode()) body.seen = deviceSeen();
    const r = await api('/api/practice/start', { method: 'POST', body });
    rememberSeen(r.questions.map((q) => q.id));
    return r;
  }
  async function practiceSetup(course, groupName) {
    const cat = await api('/api/catalog');
    const c = cat.courses.find((x) => x.course === course);
    if (!c) { html(`<div class="notice">No practice questions for ${esc(course)} yet.</div><a href="#/">Back</a>`); return; }
    const startGroup = groupName ? c.groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase()) : null;
    const startTopics = startGroup ? startGroup.topics : c.topics.map((t) => t.topic);
    html(`
      <p class="small"><a href="#/">← Home</a></p>
      <h1>${esc(course)} practice</h1>
      ${groupName && !startGroup ? `<div class="notice small">“${esc(groupName)}” isn't available any more, so all topics are selected.</div>` : ''}
      <div class="card">
        ${c.groups.length ? `
        <div class="field" style="margin-bottom:12px"><span>Quick pick</span>
          <div class="seg wrap" id="groupSeg" role="radiogroup" aria-label="Quick pick">
            ${c.groups.map((g) => `<button type="button" role="radio" data-group="${g.id}">${esc(g.name)}</button>`).join('')}
            <button type="button" role="radio" data-group="all">All topics</button>
          </div>
          <div class="small muted" id="groupNote" style="margin-top:6px"></div>
        </div>` : ''}
        <strong>Topics</strong>
        <div class="row small" style="margin:4px 0"><a href="#" id="all">All</a> · <a href="#" id="none">None</a></div>
        <div id="topics">${c.topics.map((t) => `<label class="check"><input type="checkbox" value="${esc(t.topic)}" ${startTopics.includes(t.topic) ? 'checked' : ''}> ${esc(t.topic)} <span class="muted small">(${t.n})</span></label>`).join('')}</div>
        <div class="field" style="margin-top:12px"><span>Number of questions</span>
          <div class="seg" id="countSeg" role="radiogroup" aria-label="Number of questions">
            ${[10, 20, 40].map((n) => `<button type="button" role="radio" data-n="${n}" aria-checked="${n === 10}" class="${n === 10 ? 'on' : ''}">${n}</button>`).join('')}
            <button type="button" role="radio" data-n="custom" aria-checked="false">Custom</button>
          </div>
          <div id="customWrap" hidden style="margin-top:8px">
            <input type="number" id="customCount" min="1" max="${MAX_Q}" inputmode="numeric" placeholder="How many? (1–${MAX_Q})">
          </div>
          <div class="small muted" id="availNote" style="margin-top:6px"></div>
        </div>
        <div id="msg"></div>
        <button id="go">Start practice</button>
      </div>`);
    const boxes = () => [...document.querySelectorAll('#topics input')];
    const counts = Object.fromEntries(c.topics.map((t) => [t.topic, t.n]));
    const available = () => boxes().filter((b) => b.checked).reduce((sum, b) => sum + (counts[b.value] || 0), 0);
    let choice = 10;
    const seg = document.getElementById('countSeg'), customWrap = document.getElementById('customWrap'), customInput = document.getElementById('customCount');
    const wanted = () => (choice === 'custom' ? parseInt(customInput.value, 10) : choice);
    // Quick pick: a group ticks exactly its topics. Ticking boxes by hand lights up whichever
    // group (if any) now matches the selection exactly.
    const groupSeg = document.getElementById('groupSeg');
    const syncGroups = () => {
      if (!groupSeg) return;
      const sel = boxes().filter((b) => b.checked).map((b) => b.value).sort().join('\n');
      const key = (list) => [...list].sort().join('\n');
      const match = c.groups.find((g) => key(g.topics) === sel);
      const id = match ? String(match.id) : sel === key(c.topics.map((t) => t.topic)) ? 'all' : null;
      groupSeg.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.group === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
      });
      document.getElementById('groupNote').textContent = match
        ? `${match.topics.length} topic${match.topics.length === 1 ? '' : 's'}: ${match.topics.join(', ')}` : '';
    };
    if (groupSeg) groupSeg.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const g = c.groups.find((x) => String(x.id) === b.dataset.group);
      boxes().forEach((x) => (x.checked = g ? g.topics.includes(x.value) : true));
      updateNote();
    };
    const updateNote = () => {
      const n = available(), w = wanted();
      document.getElementById('availNote').textContent = !n ? 'Pick at least one topic.'
        : Number.isInteger(w) && w > n ? `Only ${n} question${n === 1 ? '' : 's'} in the topics you picked, so you'll get all ${n}.`
        : `${n} question${n === 1 ? '' : 's'} available in the topics you picked.`;
      syncGroups();
    };
    seg.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      choice = b.dataset.n === 'custom' ? 'custom' : +b.dataset.n;
      customWrap.hidden = choice !== 'custom';
      if (choice === 'custom') customInput.focus();
      updateNote();
    };
    customInput.oninput = () => { document.getElementById('msg').innerHTML = ''; updateNote(); };
    document.getElementById('topics').onchange = updateNote;
    document.getElementById('all').onclick = (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = true)); updateNote(); };
    document.getElementById('none').onclick = (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = false)); updateNote(); };
    updateNote();
    document.getElementById('go').onclick = async () => {
      const topics = boxes().filter((b) => b.checked).map((b) => b.value);
      if (!topics.length) { document.getElementById('msg').innerHTML = errorBox('Pick at least one topic'); return; }
      const n = wanted();
      if (!Number.isInteger(n) || n < 1 || n > MAX_Q) { document.getElementById('msg').innerHTML = errorBox(`Enter a number from 1 to ${MAX_Q}`); customInput.focus(); return; }
      document.getElementById('msg').innerHTML = '';
      try {
        const r = await startPractice(course, topics, n);
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
          const r = await startPractice(course, topics, questions.length);
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
              <div>${pct(res.score, res.total)}% · ${fmtDur(res.durationMs)}${res.optedOut ? '' : ` · currently <strong>#${res.rank}</strong>`}</div>
              ${res.optedOut ? '<div class="small muted" style="margin-top:6px">You\'ve opted out of leaderboards, so this score is private. Change it any time in Profile.</div>' : ''}
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
    const optedOutNote = (r) => (r.youOptedOut ? '<div class="notice small">You\'ve opted out, so you won\'t appear here. <a href="#/profile">Change in Profile</a></div>' : '');
    const table = (head, rows) => rows.length
      ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<div class="empty">No one on the board yet. Be the first!</div>';
    if (which === 'overall') {
      const r = await api('/api/leaderboard/overall');
      board.innerHTML = optedOutNote(r) + `<p class="small muted">Total correct answers across all ranked tests.</p>` + table('<th>#</th><th>Nickname</th><th class="num">Points</th><th class="num">Tests</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.points}</td><td class="num">${x.tests}</td></tr>`));
    } else if (which === 'practice') {
      const r = await api('/api/leaderboard/practice');
      board.innerHTML = optedOutNote(r) + `<p class="small muted">Different questions answered correctly in practice over the last 7 days.</p>` + table('<th>#</th><th>Nickname</th><th class="num">Correct</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.correct}</td></tr>`));
    } else {
      const id = +which.replace('test', '');
      const r = await api(`/api/leaderboard/ranked/${id}`);
      board.innerHTML = optedOutNote(r) + `<p class="small muted">Highest score wins; fastest time breaks ties.${r.test.status === 'closed' ? ` <a href="#/review/${id}">Review answers</a>` : ''}</p>` + table('<th>#</th><th>Nickname</th><th class="num">Score</th><th class="num">Time</th>',
        r.rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.rank}</td><td>${esc(x.nickname)}</td><td class="num">${x.score}/${x.total}</td><td class="num">${fmtDur(x.durationMs)}</td></tr>`));
    }
  }


  // ---------- question updates (corrections) ----------
  function setUpdateBadge(n) {
    const link = document.querySelector('[data-nav="profile"]');
    if (!link) return;
    let b = link.querySelector('.navdot');
    if (n && !b) { b = document.createElement('span'); b.className = 'navdot'; link.appendChild(b); }
    if (b) { if (n) { b.textContent = n; b.title = `${n} question update${n === 1 ? '' : 's'}`; } else b.remove(); }
  }
  async function updatesPage() {
    if (!hasCode()) { location.hash = '#/welcome'; return; }
    const r = await api('/api/updates');
    const changeWords = { answer: 'correct answer', options: 'answer choices', question: 'question wording', rationale: 'explanation' };
    html(`
      <p class="small"><a href="#/profile">← Profile</a></p>
      <h1>Question updates</h1>
      <p class="small muted">When a question you've answered is corrected (often thanks to a student's flag), it shows up here.</p>
      ${r.updates.length ? r.updates.map((u) => {
        const d = u.data || {};
        const what = (d.changes || []).map((c) => changeWords[c] || c);
        const ranked = (d.ranked || []).filter((x) => x.old !== x.new);
        return `<div class="card ${u.read_at ? 'read' : ''}">
          <div class="row small muted">${u.read_at ? '' : '<span class="pill open">New</span>'}<span>Corrected ${fmtDate(u.created_at)}</span>${what.length ? `<span>· updated ${esc(what.join(', '))}</span>` : ''}</div>
          ${d.flagged ? '<div class="notice good small" style="margin:8px 0 0">⚑ Thanks for flagging this question. Your report helped fix it.</div>' : ''}
          <div class="stem" style="margin:10px 0 8px">${esc(d.stem)}</div>
          ${d.oldStem ? `<div class="small muted" style="margin-bottom:8px">Previously: <s>${esc(d.oldStem)}</s></div>` : ''}
          <div class="option correct"><span class="letter">✓</span><span><strong>Correct answer:</strong> ${esc(d.answer)}</span></div>
          ${d.oldAnswer ? `<div class="option" style="margin-top:6px"><span class="letter">✕</span><span class="muted">Previously marked correct: <s>${esc(d.oldAnswer)}</s></span></div>` : ''}
          ${d.rationale ? `<div class="rationale small">${esc(d.rationale)}</div>` : ''}
          ${ranked.map((x) => `<div class="small" style="margin-top:8px">Your score on <a href="#/leaderboard/test${x.test}">${esc(x.title)}</a> was updated: <s>${x.old}/${x.total}</s> → <strong>${x.new}/${x.total}</strong></div>`).join('')}
        </div>`;
      }).join('') : '<div class="card empty">No updates yet.</div>'}`);
    if (r.updates.some((u) => !u.read_at)) {
      try { await api('/api/updates/read', { method: 'POST' }); } catch {}
      setUpdateBadge(0);
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
    setUpdateBadge(r.unreadUpdates);
    html(`
      <h1>${esc(r.nickname)}</h1>
      ${r.hidden ? '<div class="notice small">An admin has hidden you from leaderboards.</div>' : ''}
      ${r.unreadUpdates ? `<a class="notice update-note" href="#/updates">🔔 <strong>${r.unreadUpdates} new question update${r.unreadUpdates === 1 ? '' : 's'}.</strong> <span>See what changed →</span></a>` : '<p class="small"><a href="#/updates">Question updates</a></p>'}
      <h2>Leaderboards</h2>
      <div class="card">
        <div class="row"><strong>${r.onLeaderboard ? 'You\'re on the leaderboards' : 'You\'ve opted out'}</strong><span class="pill ${r.onLeaderboard ? 'open' : 'closed'}">${r.onLeaderboard ? 'Visible' : 'Private'}</span></div>
        <p class="small muted" style="margin:6px 0 10px">${r.onLeaderboard
          ? 'Your nickname and scores appear on the ranked and practice leaderboards.'
          : 'Your nickname doesn\'t appear on any leaderboard. You can still take ranked tests, and your scores show here.'}</p>
        <div id="lbMsg"></div>
        <button class="${r.onLeaderboard ? 'secondary' : ''} small" id="lbToggle">${r.onLeaderboard ? 'Opt out of leaderboards' : 'Join the leaderboards'}</button>
      </div>
      <h2>Nickname</h2>
      <div class="card">
        <form id="nickForm" class="row">
          <input type="text" id="newNick" value="${esc(r.nickname)}" maxlength="20" autocomplete="off" style="flex:1;min-width:160px">
          <button class="small">Save</button>
        </form>
        <div id="nickMsg" style="margin-top:8px"></div>
        <p class="small muted" style="margin:6px 0 0">Shown on leaderboards. Don't use your full name. Your study code stays the same.</p>
      </div>
      <div class="card">
        <strong>Your study code</strong>
        <p class="small muted" style="margin:4px 0 0">Use it to sign in on another device. Keep it private.</p>
        <div class="code-box" id="codeBox">••••••••••</div>
        <div class="row"><button class="secondary small" id="reveal">Show</button><button class="secondary small" id="copy">Copy</button></div>
      </div>
      <h2>Practice</h2>
      <div class="card">
        <p class="small muted">${r.weeklyCorrect} different questions answered correctly in the last 7 days.</p>
        ${(r.coverage || []).filter((c) => c.total).map((c) => `<div class="small" style="margin:8px 0 2px"><span>${esc(c.course)}</span><span class="muted" style="float:right">seen ${c.seen} of ${c.total}</span></div>
          <div class="progress" style="margin:0 0 6px"><div style="width:${pct(c.seen, c.total)}%"></div></div>`).join('')}
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
      <p class="small"><a href="#" id="signout">Sign out on this device</a></p>
      <h2>Delete my account</h2>
      <div class="card" id="delCard">
        <p class="small" style="margin-bottom:10px">Permanently removes your study code, nickname, practice history and ranked test scores. Your code will stop working and this can't be undone. Any questions you flagged stay for review, but without your name.</p>
        <button class="small danger" id="delStart">Delete my account</button>
      </div>`);
    document.getElementById('lbToggle').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await api('/api/me/settings', { method: 'POST', body: { onLeaderboard: !r.onLeaderboard, lbPrompted: true } });
        mePage();
      } catch (err) { document.getElementById('lbMsg').innerHTML = errorBox(err); e.target.disabled = false; }
    };
    document.getElementById('nickForm').onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById('nickMsg');
      const nickname = document.getElementById('newNick').value.trim();
      if (nickname === r.nickname) { msg.innerHTML = '<div class="notice small">That\'s already your nickname.</div>'; return; }
      try {
        const res = await api('/api/me/settings', { method: 'POST', body: { nickname } });
        store.set(LS_NICK, res.nickname);
        r.nickname = res.nickname;
        document.querySelector('main h1').textContent = res.nickname;
        msg.innerHTML = `<div class="notice good small">Nickname changed to ${esc(res.nickname)}.</div>`;
      } catch (err) { msg.innerHTML = errorBox(err); }
    };
    document.getElementById('delStart').onclick = () => {
      const card = document.getElementById('delCard');
      card.innerHTML = `<p class="small"><strong>Are you sure?</strong> Type <strong>DELETE</strong> below to permanently delete <strong>${esc(r.nickname)}</strong>.</p>
        <input type="text" id="delConfirm" autocomplete="off" autocapitalize="characters" placeholder="DELETE">
        <div id="delMsg" style="margin-top:8px"></div>
        <div class="row" style="margin-top:10px"><button class="small danger" id="delGo" disabled>Delete permanently</button><button class="small ghost" id="delCancel">Cancel</button></div>`;
      const input = document.getElementById('delConfirm'), go = document.getElementById('delGo');
      input.focus();
      input.oninput = () => { go.disabled = input.value.trim().toUpperCase() !== 'DELETE'; };
      document.getElementById('delCancel').onclick = () => mePage();
      go.onclick = async () => {
        go.disabled = true;
        try {
          await api('/api/me/delete', { method: 'POST', body: { confirm: input.value } });
          store.del(LS_CODE); store.del(LS_NICK); store.del('pn_skip');
          html(`<h1>Account deleted</h1>
            <div class="card"><p>Your study code, nickname and scores have been removed. Thanks for studying with PN Practice.</p>
            <a class="btn" href="#/welcome">Back to start</a></div>`);
        } catch (err) { document.getElementById('delMsg').innerHTML = errorBox(err); go.disabled = false; }
      };
    };
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
