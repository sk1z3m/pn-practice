// PN Practice — admin page
(() => {
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const KEY = 'pn_admin_key';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (i) => String.fromCharCode(65 + i);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const fmtDur = (ms) => { if (ms == null) return ''; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => new Date(v).getTime();
  const ss = {
    get() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(KEY, v); } catch {} },
    del() { try { sessionStorage.removeItem(KEY); } catch {} },
  };
  let adminKey = ss.get();

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', 'x-admin-key': adminKey || '' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401) { ss.del(); adminKey = null; login('That password didn\'t match the ADMIN_KEY secret. Check capitals and spaces.'); throw new Error('Wrong admin password'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const html = (s) => { app.innerHTML = s; };
  const err = (e) => `<div class="notice error">${esc(e.message || e)}</div>`;
  const flash = (el, msg, ok = true) => { el.innerHTML = `<div class="notice ${ok ? 'good' : 'error'}">${esc(msg)}</div>`; };

  // ---------- login ----------
  function login(msg) {
    nav.style.display = 'none';
    html(`<h1>Admin sign in</h1>
      <div class="card" style="max-width:420px">
        ${msg ? `<div class="notice error">${esc(msg)}</div>` : ''}
        <form id="f"><label class="field"><span>Admin password</span><input type="password" id="pw" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required></label>
        <button>Sign in</button></form>
      </div>`);
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      adminKey = document.getElementById('pw').value;
      try {
        await api('/api/admin/check');
        ss.set(adminKey);
        start();
      } catch (e2) { /* api() already re-rendered on 401 */ if (!String(e2.message).includes('password')) login(e2.message); }
    };
  }

  // ---------- tabs ----------
  const tabs = { questions, import: importTab, ranked, players };
  async function start() {
    nav.style.display = '';
    const tab = location.hash.replace('#', '') || 'questions';
    nav.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab.split('/')[0]));
    const fn = tabs[tab.split('/')[0]] || questions;
    html('<p class="muted">Loading…</p>');
    try { await fn(tab.split('/').slice(1)); } catch (e) { if (adminKey) html(err(e)); }
  }
  window.addEventListener('hashchange', () => adminKey && start());

  // ---------- questions ----------
  const qState = { status: 'draft', course: '', topic: '', q: '' };
  async function questions() {
    const params = new URLSearchParams();
    if (qState.status) params.set('status', qState.status);
    if (qState.course) params.set('course', qState.course);
    if (qState.q) params.set('q', qState.q);
    const r = await api('/api/admin/questions?' + params);
    const topicList = [...new Set(r.questions.map((x) => x.topic))].sort();
    if (qState.topic && !topicList.includes(qState.topic)) qState.topic = '';
    if (qState.topic) r.questions = r.questions.filter((x) => x.topic === qState.topic);
    const c = r.counts;
    html(`
      <h1>Question bank</h1>
      <p class="small muted">${c.approved || 0} approved (live) · ${c.draft || 0} draft${c.draft === 1 ? '' : 's'} waiting for review · ${c.retired || 0} retired. Only approved questions appear to students.</p>
      <div class="card row">
        <select id="fStatus" style="width:auto">
          ${[['draft', 'Drafts'], ['approved', 'Approved'], ['retired', 'Retired'], ['', 'All']].map(([v, l]) => `<option value="${v}" ${qState.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="fCourse" style="width:auto"><option value="">All courses</option>${r.courses.map((x) => `<option ${qState.course === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="fTopic" style="width:auto"><option value="">All topics</option>${topicList.map((x) => `<option ${qState.topic === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <input type="text" id="fQ" placeholder="Search text, topic, source" value="${esc(qState.q)}" style="flex:1;min-width:160px">
      </div>
      <div class="bar row">
        <label class="check"><input type="checkbox" id="selAll"> Select all (${r.questions.length})</label>
        <span class="spacer"></span>
        <button class="small" data-bulk="approved">Approve selected</button>
        <button class="small ghost" data-bulk="draft">Move to drafts</button>
        <button class="small danger" data-bulk="retired">Retire selected</button>
      </div>
      <div id="msg"></div>
      <div id="list">${r.questions.length ? r.questions.map(qCard).join('') : '<div class="card empty">Nothing here.</div>'}</div>`);

    const reload = () => questions().catch((e) => html(err(e)));
    document.getElementById('fStatus').onchange = (e) => { qState.status = e.target.value; reload(); };
    document.getElementById('fCourse').onchange = (e) => { qState.course = e.target.value; qState.topic = ''; reload(); };
    document.getElementById('fTopic').onchange = (e) => { qState.topic = e.target.value; reload(); };
    let t; document.getElementById('fQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { qState.q = e.target.value; reload(); }, 350); };
    document.getElementById('selAll').onchange = (e) => document.querySelectorAll('.sel').forEach((b) => (b.checked = e.target.checked));
    document.querySelectorAll('[data-bulk]').forEach((b) => (b.onclick = async () => {
      const ids = [...document.querySelectorAll('.sel:checked')].map((x) => +x.value);
      if (!ids.length) return flash(document.getElementById('msg'), 'Select some questions first', false);
      await api('/api/admin/questions/status', { method: 'POST', body: { ids, status: b.dataset.bulk } });
      reload();
    }));
    const byId = Object.fromEntries(r.questions.map((q) => [q.id, q]));
    document.getElementById('list').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const id = +b.closest('[data-id]').dataset.id;
      const q = byId[id];
      try {
        if (b.dataset.act === 'status') { await api(`/api/admin/questions/${id}`, { method: 'PUT', body: { status: b.dataset.s } }); reload(); }
        if (b.dataset.act === 'delete') { if (confirm('Delete this question permanently?')) { await api(`/api/admin/questions/${id}`, { method: 'DELETE' }); reload(); } }
        if (b.dataset.act === 'edit') editQuestion(q, b.closest('[data-id]'), reload);
      } catch (e2) { flash(document.getElementById('msg'), e2.message, false); }
    };
  }
  function qCard(q) {
    const stats = q.answered ? `${q.answered} practice answers, ${Math.round((100 * (q.answeredCorrect || 0)) / q.answered)}% correct` : 'not answered yet';
    return `<div class="card" data-id="${q.id}"><div class="qrow">
      <input type="checkbox" class="sel" value="${q.id}">
      <div>
        <div class="row small muted"><span class="pill ${q.status}">${q.status}</span><span>#${q.id} · ${esc(q.course)} · ${esc(q.topic)}</span>${q.inRanked ? '<span class="pill">in ranked test</span>' : ''}</div>
        <div style="font-weight:600;margin-top:6px">${esc(q.stem)}</div>
        <ol type="A">${q.options.map((o, i) => `<li class="${i === q.answer ? 'ans' : ''}">${esc(o)}${i === q.answer ? ' ✓' : ''}</li>`).join('')}</ol>
        <div class="small">${esc(q.rationale) || '<em class="muted">No rationale</em>'}</div>
        <div class="small muted" style="margin-top:4px">Source: ${esc(q.source) || '—'} · ${stats}</div>
        <div class="row" style="margin-top:10px">
          ${q.status !== 'approved' ? '<button class="small" data-act="status" data-s="approved">Approve</button>' : ''}
          <button class="small secondary" data-act="edit">Edit</button>
          ${q.status !== 'retired' ? '<button class="small ghost" data-act="status" data-s="retired">Retire</button>' : '<button class="small ghost" data-act="status" data-s="draft">Restore to draft</button>'}
          ${!q.inRanked ? '<button class="small danger" data-act="delete">Delete</button>' : ''}
        </div>
      </div></div></div>`;
  }
  function editQuestion(q, el, done) {
    el.innerHTML = `<form class="stack" id="ef${q.id}">
      <div class="grid2">
        <label class="field"><span>Course</span><input type="text" name="course" value="${esc(q.course)}"></label>
        <label class="field"><span>Topic</span><input type="text" name="topic" value="${esc(q.topic)}"></label>
      </div>
      <label class="field"><span>Question</span><textarea name="stem">${esc(q.stem)}</textarea></label>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="row"><label class="check" title="Correct answer"><input type="radio" name="answer" value="${i}" ${i === q.answer ? 'checked' : ''}> ${L(i)}</label>
        <input type="text" name="opt${i}" value="${esc(q.options[i] || '')}" placeholder="${i < 2 ? 'Option' : 'Option (optional)'}" style="flex:1"></div>`).join('')}
      <label class="field"><span>Rationale</span><textarea name="rationale">${esc(q.rationale)}</textarea></label>
      <label class="field"><span>Source (deck / slide)</span><input type="text" name="source" value="${esc(q.source)}"></label>
      <div class="msg"></div>
      <div class="row"><button>Save</button><button type="button" class="ghost cancel">Cancel</button></div>
    </form>`;
    const f = el.querySelector('form');
    f.querySelector('.cancel').onclick = done;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      // keep the chosen answer pointing at the same text after empty options are dropped
      const raw = [0, 1, 2, 3, 4, 5].map((i) => String(fd.get('opt' + i) || '').trim());
      const chosen = +fd.get('answer');
      if (!raw[chosen]) return flash(f.querySelector('.msg'), 'The correct answer option is empty', false);
      const options = raw.filter(Boolean);
      const answer = raw.slice(0, chosen).filter(Boolean).length;
      try {
        await api(`/api/admin/questions/${q.id}`, { method: 'PUT', body: {
          course: fd.get('course'), topic: fd.get('topic'), stem: fd.get('stem'), options, answer,
          rationale: fd.get('rationale'), source: fd.get('source') } });
        done();
      } catch (e2) { flash(f.querySelector('.msg'), e2.message, false); }
    };
  }

  // ---------- import ----------
  const PROMPT = `Using ONLY the content in the attached lecture deck, write 25 multiple-choice questions for second-year Practical Nursing students.

Rules:
- 4 options each, exactly one clearly correct answer, plausible wrong answers
- Mix recall and application (patient scenario) questions
- Vary which letter is correct
- Rationale: 1–3 sentences explaining why the answer is right (and why a tempting wrong answer is wrong, if useful)
- Source: deck title and slide number the question comes from
- Topic: a short topic name from the deck (reuse the same names so questions group well)

Reply with ONLY valid JSON in exactly this format, no other text:
{"course": "Pharmacology", "questions": [
  {"topic": "Opioids", "stem": "Question text?", "options": ["A text", "B text", "C text", "D text"], "answer": "B", "rationale": "Why B is correct.", "source": "Week 6 Pain, slide 14"}
]}`;
  async function importTab() {
    html(`
      <h1>Import questions</h1>
      <div class="card">
        <strong>1. Generate questions in Claude</strong>
        <p class="small muted" style="margin:4px 0">Upload a lecture deck to Claude.ai and send this prompt. Change the course name and question count to suit.</p>
        <pre class="prompt" id="prompt">${esc(PROMPT)}</pre>
        <button class="small secondary" id="copyPrompt">Copy prompt</button>
      </div>
      <div class="card">
        <strong>2. Paste Claude's JSON here, or choose a .json file</strong>
        <div class="row" style="justify-content:flex-start;margin-top:6px"><input type="file" id="file" accept=".json,application/json" style="font-size:.9rem"></div>
        <textarea id="json" style="min-height:220px;font-family:ui-monospace,monospace;font-size:.85rem;margin-top:8px" placeholder='{"course": "...", "questions": [...]}'></textarea>
        <div class="grid2" style="margin-top:8px">
          <label class="field"><span>Course (used if a question doesn't name one)</span><input type="text" id="dCourse"></label>
          <label class="field"><span>Source (used if a question doesn't have one)</span><input type="text" id="dSource" placeholder="e.g. Week 7 Psychotherapeutics deck"></label>
        </div>
        <div id="preview"></div>
        <div class="row"><button class="secondary" id="check">Check</button><button id="go" disabled>Import as drafts</button></div>
        <p class="small muted" style="margin-top:8px">Imported questions start as drafts. Review them on the Questions tab and approve the good ones before students see them.</p>
      </div>`);
    document.getElementById('copyPrompt').onclick = async (e) => { try { await navigator.clipboard.writeText(PROMPT); e.target.textContent = 'Copied'; } catch {} };
    let parsed = null;
    const check = () => {
      const pv = document.getElementById('preview');
      parsed = null; document.getElementById('go').disabled = true;
      let text = document.getElementById('json').value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      if (!text) { pv.innerHTML = ''; return; }
      let data;
      try { data = JSON.parse(text); } catch (e) { pv.innerHTML = err('That isn\'t valid JSON: ' + e.message); return; }
      const list = Array.isArray(data) ? data : data.questions;
      if (!Array.isArray(list)) { pv.innerHTML = err('Couldn\'t find a "questions" list'); return; }
      const course = document.getElementById('dCourse').value.trim() || data.course || '';
      if (!document.getElementById('dCourse').value && data.course) document.getElementById('dCourse').value = data.course;
      const problems = [];
      list.forEach((q, i) => {
        const opts = q.options || [];
        let a = q.answer; if (typeof a === 'string' && /^[A-F]$/i.test(a.trim())) a = a.trim().toUpperCase().charCodeAt(0) - 65;
        if (!(q.course || course)) problems.push(`Q${i + 1}: no course`);
        if (!(q.stem || q.question)) problems.push(`Q${i + 1}: no question text`);
        if (opts.length < 2 || opts.length > 6) problems.push(`Q${i + 1}: needs 2–6 options`);
        if (!(+a >= 0 && +a < opts.length)) problems.push(`Q${i + 1}: answer doesn't match an option`);
        if (!q.rationale) problems.push(`Q${i + 1}: no rationale (allowed, but students learn less)`);
      });
      const blocking = problems.filter((p) => !p.includes('rationale'));
      const topics = [...new Set(list.map((q) => q.topic || 'General'))];
      const courses = [...new Set(list.map((q) => q.course || course).filter(Boolean))];
      pv.innerHTML = `<div class="notice ${blocking.length ? 'error' : 'good'}">
        ${list.length} questions · course: ${esc(courses.join(', ') || '(missing)')} · ${topics.length} topic${topics.length === 1 ? '' : 's'}: ${esc(topics.join(', '))}
        ${problems.length ? `<ul class="small" style="margin:6px 0 0">${problems.slice(0, 15).map((p) => `<li>${esc(p)}</li>`).join('')}${problems.length > 15 ? `<li>…and ${problems.length - 15} more</li>` : ''}</ul>` : ''}</div>`;
      if (!blocking.length) { parsed = { list, course }; document.getElementById('go').disabled = false; }
    };
    document.getElementById('check').onclick = check;
    document.getElementById('json').oninput = () => { document.getElementById('go').disabled = true; };
    document.getElementById('file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      document.getElementById('json').value = await f.text();
      check();
    };
    document.getElementById('go').onclick = async (e) => {
      check(); if (!parsed) return;
      e.target.disabled = true;
      try {
        const r = await api('/api/admin/questions/import', { method: 'POST', body: {
          course: document.getElementById('dCourse').value.trim() || parsed.course,
          source: document.getElementById('dSource').value.trim(),
          questions: parsed.list } });
        document.getElementById('preview').innerHTML = `<div class="notice good">Imported ${r.imported} questions as drafts. <a href="#questions">Review them →</a></div>`;
        document.getElementById('json').value = '';
        qState.status = 'draft';
      } catch (e2) { document.getElementById('preview').innerHTML = err(e2); e.target.disabled = false; }
    };
  }

  // ---------- ranked ----------
  async function ranked(args) {
    if (args[0] === 'new') return rankedNew();
    if (args[0]) return rankedResults(+args[0]);
    const r = await api('/api/admin/ranked');
    html(`
      <div class="row"><h1>Ranked tests</h1><span class="spacer"></span><a class="btn" href="#ranked/new">New ranked test</a></div>
      ${r.tests.length ? r.tests.map((t) => `<div class="card">
        <div class="row"><strong>${esc(t.title)}</strong><span class="pill ${t.status}">${t.status}</span></div>
        <div class="small muted">${esc(t.course)} · ${t.questionCount} questions · ${fmtDate(t.opens_at)} → ${fmtDate(t.closes_at)} · ${t.submitted} submitted${t.attempts > t.submitted ? `, ${t.attempts - t.submitted} in progress` : ''}</div>
        <div class="row" style="margin-top:10px"><a class="btn small secondary" href="#ranked/${t.id}">Results &amp; settings</a></div>
      </div>`).join('') : '<div class="card empty">No ranked tests yet.</div>'}`);
  }

  async function rankedNew() {
    const r = await api('/api/admin/questions?status=approved');
    const courses = [...new Set(r.questions.map((q) => q.course))];
    const now = Date.now();
    const nextWeek = now + 7 * 864e5;
    html(`
      <p class="small"><a href="#ranked">← Ranked tests</a></p>
      <h1>New ranked test</h1>
      <form id="f" class="card">
        <label class="field"><span>Title</span><input type="text" name="title" required placeholder="e.g. CNS Pharm Ranked #1"></label>
        <div class="grid2">
          <label class="field"><span>Course</span><select name="course" id="course">${courses.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Description (optional)</span><input type="text" name="description"></label>
          <label class="field"><span>Opens</span><input type="datetime-local" name="opens" value="${toLocalInput(now)}" required></label>
          <label class="field"><span>Closes</span><input type="datetime-local" name="closes" value="${toLocalInput(nextWeek)}" required></label>
        </div>
        <div class="row" style="margin:6px 0">
          <strong>Questions</strong> <span class="small muted" id="selCount"></span><span class="spacer"></span>
          <select id="topicF" style="width:auto"></select>
          <input type="number" id="randN" value="10" min="1" max="100" style="width:80px">
          <button type="button" class="small secondary" id="rand">Pick random</button>
          <button type="button" class="small ghost" id="clear">Clear</button>
        </div>
        <div class="picker" id="picker"></div>
        <p class="small muted">These questions will be hidden from practice until the test closes, then return to the practice pool.</p>
        <div id="msg"></div>
        <button>Create test</button>
      </form>`);
    const courseSel = document.getElementById('course');
    const picker = document.getElementById('picker');
    const topicF = document.getElementById('topicF');
    const count = () => (document.getElementById('selCount').textContent = `(${picker.querySelectorAll('input:checked').length} selected)`);
    const renderPicker = () => {
      const qs = r.questions.filter((q) => q.course === courseSel.value);
      const topics = [...new Set(qs.map((q) => q.topic))];
      topicF.innerHTML = `<option value="">All topics</option>${topics.map((t) => `<option>${esc(t)}</option>`).join('')}`;
      picker.innerHTML = qs.map((q) => `<label class="check" data-topic="${esc(q.topic)}"><input type="checkbox" value="${q.id}"><span><span class="small muted">#${q.id} · ${esc(q.topic)}${q.inRanked ? ' · used in another ranked test' : ''}</span><br>${esc(q.stem)}</span></label>`).join('') || '<div class="empty">No approved questions for this course.</div>';
      count();
    };
    courseSel.onchange = renderPicker;
    topicF.onchange = () => picker.querySelectorAll('[data-topic]').forEach((el) => (el.style.display = !topicF.value || el.dataset.topic === topicF.value ? '' : 'none'));
    picker.onchange = count;
    document.getElementById('clear').onclick = () => { picker.querySelectorAll('input').forEach((b) => (b.checked = false)); count(); };
    document.getElementById('rand').onclick = () => {
      const visible = [...picker.querySelectorAll('[data-topic]')].filter((el) => el.style.display !== 'none').map((el) => el.querySelector('input'));
      visible.forEach((b) => (b.checked = false));
      const n = Math.min(+document.getElementById('randN').value || 10, visible.length);
      visible.sort(() => Math.random() - 0.5).slice(0, n).forEach((b) => (b.checked = true));
      count();
    };
    renderPicker();
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const question_ids = [...picker.querySelectorAll('input:checked')].map((b) => +b.value);
      try {
        const res = await api('/api/admin/ranked', { method: 'POST', body: {
          title: fd.get('title'), course: fd.get('course'), description: fd.get('description'),
          opens_at: fromLocalInput(fd.get('opens')), closes_at: fromLocalInput(fd.get('closes')), question_ids } });
        location.hash = `#ranked/${res.id}`;
      } catch (e2) { document.getElementById('msg').innerHTML = err(e2); }
    };
  }

  async function rankedResults(id) {
    const r = await api(`/api/admin/ranked/${id}/results`);
    const t = r.test;
    html(`
      <p class="small"><a href="#ranked">← Ranked tests</a></p>
      <div class="row"><h1>${esc(t.title)}</h1><span class="pill ${t.status}">${t.status}</span></div>
      <form id="f" class="card">
        <div class="grid2">
          <label class="field"><span>Title</span><input type="text" name="title" value="${esc(t.title)}"></label>
          <label class="field"><span>Description</span><input type="text" name="description" value="${esc(t.description)}"></label>
          <label class="field"><span>Opens</span><input type="datetime-local" name="opens" value="${toLocalInput(t.opens_at)}"></label>
          <label class="field"><span>Closes</span><input type="datetime-local" name="closes" value="${toLocalInput(t.closes_at)}"></label>
        </div>
        <div id="msg"></div>
        <div class="row"><button>Save changes</button><span class="spacer"></span><button type="button" class="danger" id="del">Delete test</button></div>
      </form>
      <h2>Attempts (${r.attempts.length})</h2>
      <div class="card table-wrap">
        ${r.attempts.length ? `<table><thead><tr><th>Nickname</th><th class="num">Score</th><th class="num">Time</th><th>Submitted</th><th></th></tr></thead><tbody>
          ${r.attempts.map((a) => `<tr><td>${esc(a.nickname)}${a.hidden ? ' <span class="pill closed">hidden</span>' : ''}<div class="small muted">code made ${fmtDate(a.playerCreated)}</div></td>
            <td class="num">${a.submitted_at ? `${a.score}/${a.total}` : '—'}</td>
            <td class="num">${a.submitted_at ? fmtDur(a.submitted_at - a.started_at) : 'in progress'}</td>
            <td class="small">${fmtDate(a.submitted_at)}</td>
            <td><button class="small danger" data-del="${a.id}" title="Removes this attempt so the student could take it again">Remove</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No attempts yet.</div>'}
      </div>
      <h2>Questions: % of class correct</h2>
      <div class="card table-wrap"><table><thead><tr><th>#</th><th>Question</th><th class="num">Correct</th></tr></thead><tbody>
        ${r.questions.map((q, i) => `<tr><td>${i + 1}</td><td><span class="small muted">${esc(q.topic)}</span><br>${esc(q.stem)}</td><td class="num">${q.percent == null ? '—' : q.percent + '%'}</td></tr>`).join('')}
      </tbody></table></div>`);
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/api/admin/ranked/${id}`, { method: 'PUT', body: { title: fd.get('title'), description: fd.get('description'),
          opens_at: fromLocalInput(fd.get('opens')), closes_at: fromLocalInput(fd.get('closes')) } });
        flash(document.getElementById('msg'), 'Saved');
      } catch (e2) { flash(document.getElementById('msg'), e2.message, false); }
    };
    document.getElementById('del').onclick = async () => {
      if (!confirm('Delete this test and all its attempts? This cannot be undone.')) return;
      await api(`/api/admin/ranked/${id}`, { method: 'DELETE' });
      location.hash = '#ranked';
    };
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this attempt? Their score comes off the leaderboard and they could take the test again.')) return;
      await api(`/api/admin/attempts/${b.dataset.del}`, { method: 'DELETE' });
      rankedResults(id);
    }));
  }

  // ---------- players ----------
  async function players() {
    const r = await api('/api/admin/players');
    html(`
      <h1>Players</h1>
      <p class="small muted">Study codes aren't stored and can't be shown. You can rename a nickname or hide someone from leaderboards.</p>
      <div id="msg"></div>
      <div class="card table-wrap">
        ${r.players.length ? `<table><thead><tr><th>Nickname</th><th>Joined</th><th class="num">Practice</th><th class="num">Ranked</th><th></th></tr></thead><tbody>
        ${r.players.map((p) => `<tr data-id="${p.id}"><td>${esc(p.nickname)}${p.hidden ? ' <span class="pill closed">hidden</span>' : ''}</td>
          <td class="small">${fmtDate(p.created_at)}</td><td class="num">${p.practiceAnswers}</td><td class="num">${p.rankedTests}</td>
          <td class="row"><button class="small secondary" data-act="rename">Rename</button>
          <button class="small ${p.hidden ? 'ghost' : 'danger'}" data-act="hide" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Unhide' : 'Hide'}</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No players yet.</div>'}
      </div>`);
    document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const id = b.closest('tr').dataset.id;
      try {
        if (b.dataset.act === 'rename') {
          const n = prompt('New nickname'); if (!n) return;
          await api(`/api/admin/players/${id}`, { method: 'PUT', body: { nickname: n } });
        } else {
          await api(`/api/admin/players/${id}`, { method: 'PUT', body: { hidden: !!+b.dataset.h } });
        }
        players();
      } catch (e) { flash(document.getElementById('msg'), e.message, false); }
    }));
  }

  // ---------- boot ----------
  if (adminKey) api('/api/admin/check').then(start).catch((e) => { if (adminKey) login(e.message); });
  else login();
})();
