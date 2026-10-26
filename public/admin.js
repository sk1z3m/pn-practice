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
  const tabs = { questions, topics, groups, import: importTab, flags, ranked, players };
  async function start() {
    nav.style.display = '';
    const tab = location.hash.replace('#', '') || 'questions';
    nav.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab.split('/')[0]));
    const fn = tabs[tab.split('/')[0]] || questions;
    refreshFlagCount();
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
        <button class="small secondary" id="moveOpen">Move selected…</button>
        <button class="small" data-bulk="approved">Approve selected</button>
        <button class="small ghost" data-bulk="draft">Move to drafts</button>
        <button class="small danger" data-bulk="retired">Retire selected</button>
      </div>
      <div id="moveBox" class="card" hidden>
        <strong>Move selected questions</strong>
        <div class="grid2" style="margin-top:8px">
          <label class="field"><span>Course (leave as-is to keep)</span>
            <select id="mvCourse"><option value="">Keep current course</option>${r.courses.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
          <label class="field"><span>Topic</span><input type="text" id="mvTopic" list="allTopics" placeholder="Pick or type a topic"></label>
        </div>
        <div class="row"><button class="small" id="moveGo">Move</button><button class="small ghost" id="moveCancel">Cancel</button></div>
      </div>
      <datalist id="allTopics"></datalist>
      <div id="msg"></div>
      <div id="list">${r.questions.length ? r.questions.map(qCard).join('') : '<div class="card empty">Nothing here.</div>'}</div>`);
    fillTopicList();
    const selectedIds = () => [...document.querySelectorAll('.sel:checked')].map((x) => +x.value);
    document.getElementById('moveOpen').onclick = () => {
      if (!selectedIds().length) return flash(document.getElementById('msg'), 'Select some questions first', false);
      document.getElementById('moveBox').hidden = false; document.getElementById('mvTopic').focus();
    };
    document.getElementById('moveCancel').onclick = () => { document.getElementById('moveBox').hidden = true; };
    document.getElementById('moveGo').onclick = async () => {
      const ids = selectedIds();
      const course = document.getElementById('mvCourse').value, topic = document.getElementById('mvTopic').value.trim();
      if (!ids.length) return flash(document.getElementById('msg'), 'Select some questions first', false);
      if (!course && !topic) return flash(document.getElementById('msg'), 'Pick a course or enter a topic', false);
      try {
        const res = await api('/api/admin/questions/move', { method: 'POST', body: { ids, course, topic } });
        topicCache = null;
        await questions();
        flash(document.getElementById('msg'), `Moved ${res.moved} question${res.moved === 1 ? '' : 's'}${topic ? ` to “${topic}”` : ''}${course ? ` in ${course}` : ''}.`);
      } catch (e2) { flash(document.getElementById('msg'), e2.message, false); }
    };

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
        <div class="row small muted"><span class="pill ${q.status}">${q.status}</span><span>#${q.id} · ${esc(q.course)} · ${esc(q.topic)}</span>${q.inRanked ? '<span class="pill">in ranked test</span>' : ''}${q.openFlags ? `<a class="pill flagged" href="#flags" style="text-decoration:none">⚑ ${q.openFlags} open flag${q.openFlags === 1 ? '' : 's'}</a>` : ''}</div>
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
  function editQuestion(q, el, done, opts = {}) {
    const notifyDefault = opts.notify ?? !!q.openFlags;
    el.innerHTML = `<form class="stack" id="ef${q.id}">
      <div class="grid2">
        <label class="field"><span>Course</span><input type="text" name="course" value="${esc(q.course)}"></label>
        <label class="field"><span>Topic</span><input type="text" name="topic" value="${esc(q.topic)}" list="allTopics"></label>
      </div>
      <label class="field"><span>Question</span><textarea name="stem">${esc(q.stem)}</textarea></label>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="row"><label class="check" title="Correct answer"><input type="radio" name="answer" value="${i}" ${i === q.answer ? 'checked' : ''}> ${L(i)}</label>
        <input type="text" name="opt${i}" value="${esc(q.options[i] || '')}" placeholder="${i < 2 ? 'Option' : 'Option (optional)'}" style="flex:1"></div>`).join('')}
      <label class="field"><span>Rationale</span><textarea name="rationale">${esc(q.rationale)}</textarea></label>
      <label class="field"><span>Source (deck / slide)</span><input type="text" name="source" value="${esc(q.source)}"></label>
      <label class="check small" title="Sent only if the question, options, answer or rationale actually change">
        <input type="checkbox" name="notify" ${notifyDefault ? 'checked' : ''}> Notify students who answered or flagged this question that it was corrected</label>
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
        const res = await api(`/api/admin/questions/${q.id}`, { method: 'PUT', body: {
          course: fd.get('course'), topic: fd.get('topic'), stem: fd.get('stem'), options, answer,
          rationale: fd.get('rationale'), source: fd.get('source'), notify: fd.get('notify') === 'on' } });
        await done(true, res);
        const bits = [];
        if (res.notified) bits.push(`${res.notified} student${res.notified === 1 ? '' : 's'} notified`);
        if (res.rescored) bits.push(`${res.rescored} ranked score${res.rescored === 1 ? '' : 's'} updated`);
        const m = document.getElementById('msg');
        if (m) flash(m, `Question saved${bits.length ? ': ' + bits.join(', ') : ''}.`);
      } catch (e2) { flash(f.querySelector('.msg'), e2.message, false); }
    };
  }


  // ---------- flags ----------
  // Alert banner + nav badge for open flags. Dismissing hides it until more flags come in.
  const FLAG_SEEN = 'pn_flag_dismissed';
  async function refreshFlagCount() {
    try {
      const r = await api('/api/admin/flags?status=open');
      const n = r.counts.open || 0, qs = r.groups.length;
      const badge = document.getElementById('flagCount');
      badge.textContent = n ? String(n) : '';
      badge.className = n ? 'navbadge' : '';
      let bar = document.getElementById('flagAlert');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'flagAlert'; bar.setAttribute('role', 'status');
        document.getElementById('app').before(bar);
      }
      let dismissed = 0;
      try { dismissed = +sessionStorage.getItem(FLAG_SEEN) || 0; } catch {}
      if (n < dismissed) { dismissed = n; try { sessionStorage.setItem(FLAG_SEEN, String(n)); } catch {} } // so a new flag shows again
      const onFlags = (location.hash.replace('#', '') || '').startsWith('flags');
      if (!n || onFlags || n <= dismissed) { bar.innerHTML = ''; return; }
      bar.innerHTML = `<div class="flag-alert"><span>⚑ <strong>${n} flag${n === 1 ? '' : 's'}</strong> on ${qs} question${qs === 1 ? '' : 's'} waiting for review.</span>
        <span class="spacer"></span><a class="btn small" href="#flags">Review flags</a>
        <button class="small ghost" id="flagAlertX" aria-label="Dismiss" title="Hide until new flags arrive">✕</button></div>`;
      document.getElementById('flagAlertX').onclick = () => {
        try { sessionStorage.setItem(FLAG_SEEN, String(n)); } catch {}
        bar.innerHTML = '';
      };
    } catch {}
  }
  // Check for new flags every minute while the admin page is open
  setInterval(() => { if (adminKey && document.visibilityState === 'visible') refreshFlagCount(); }, 60000);
  let flagStatus = 'open';
  async function flags() {
    const r = await api('/api/admin/flags?status=' + flagStatus);
    const c = r.counts;
    html(`
      <h1>Flagged questions</h1>
      <p class="small muted">Students flag questions they think are wrong or unclear. Check each against its source slide, then edit or retire the question and mark the flags resolved, or dismiss them if the question is fine.</p>
      <div class="tabs">${[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']].map(([k, l]) => `<button data-fs="${k}" class="${k === flagStatus ? 'active' : ''}">${l} (${c[k] || 0})</button>`).join('')}</div>
      <div id="msg"></div>
      <div id="list">${r.groups.length ? r.groups.map(flagCard).join('') : `<div class="card empty">${flagStatus === 'open' ? 'No open flags. Nice.' : 'Nothing here.'}</div>`}</div>`);
    document.querySelectorAll('[data-fs]').forEach((b) => (b.onclick = () => { flagStatus = b.dataset.fs; flags().catch((e) => html(err(e))); }));
    const byId = Object.fromEntries(r.groups.map((g) => [g.question.id, g]));
    document.getElementById('list').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const card = b.closest('[data-qid]'); const qid = +card.dataset.qid; const g = byId[qid];
      try {
        if (b.dataset.act === 'resolve' || b.dataset.act === 'dismiss' || b.dataset.act === 'reopen') {
          const status = { resolve: 'resolved', dismiss: 'dismissed', reopen: 'open' }[b.dataset.act];
          await api('/api/admin/flags/resolve', { method: 'POST', body: { questionId: qid, status } });
          flags(); refreshFlagCount();
        }
        if (b.dataset.act === 'retire') {
          if (!confirm('Retire this question so students no longer see it, and mark its flags resolved?')) return;
          await api(`/api/admin/questions/${qid}`, { method: 'PUT', body: { status: 'retired' } });
          await api('/api/admin/flags/resolve', { method: 'POST', body: { questionId: qid, status: 'resolved' } });
          flags(); refreshFlagCount();
        }
        if (b.dataset.act === 'edit') {
          const q = { ...g.question };
          const holder = card.querySelector('.qbody');
          editQuestion(q, holder, async (saved) => {
            if (saved && confirm('Saved. Mark this question\'s flags as resolved?')) await api('/api/admin/flags/resolve', { method: 'POST', body: { questionId: qid, status: 'resolved' } });
            await flags(); refreshFlagCount();
          }, { notify: true });
        }
      } catch (e2) { flash(document.getElementById('msg'), e2.message, false); }
    };
  }
  function flagCard(g) {
    const q = g.question;
    return `<div class="card" data-qid="${q.id}">
      <div class="row small muted"><span class="pill flagged">⚑ ${g.flags.length}</span><span>#${q.id} · ${esc(q.course)} · ${esc(q.topic)}</span>${q.status !== 'approved' ? `<span class="pill ${q.status}">${q.status}</span>` : ''}</div>
      <div class="qbody">
        <div style="font-weight:600;margin-top:6px">${esc(q.stem)}</div>
        <ol type="A" style="margin:6px 0;padding-left:22px">${q.options.map((o, i) => `<li style="${i === q.answer ? 'color:var(--good);font-weight:600' : ''}">${esc(o)}${i === q.answer ? ' ✓' : ''}</li>`).join('')}</ol>
        <div class="small">${esc(q.rationale)}</div>
        <div class="small muted" style="margin-top:4px">Source: ${esc(q.source) || '—'}</div>
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
        ${g.flags.map((f) => `<div class="small" style="padding:4px 0"><strong>${esc(f.reasonLabel)}</strong>${f.comment ? `: “${esc(f.comment)}”` : ''}
          <span class="muted">· ${[f.nickname || 'no code', f.context, fmtDate(f.created_at)].filter(Boolean).map(esc).join(' · ')}</span></div>`).join('')}
      </div>
      <div class="row" style="margin-top:10px">
        ${flagStatus === 'open' ? `<button class="small secondary" data-act="edit">Edit question</button>
          <button class="small ghost" data-act="retire">Retire question</button>
          <span class="spacer"></span>
          <button class="small" data-act="resolve">Mark resolved</button>
          <button class="small ghost" data-act="dismiss">Dismiss</button>`
        : '<button class="small ghost" data-act="reopen">Reopen</button>'}
      </div></div>`;
  }


  // ---------- groups ----------
  // Named sets of topics (e.g. "Test 1") that students can pick in one tap on the practice screen.
  let groupCourse = '';
  async function groups() {
    const [t, g] = await Promise.all([api('/api/admin/topics'), api('/api/admin/groups')]);
    const courses = [...new Set(t.topics.map((x) => x.course))];
    if (!courses.includes(groupCourse)) groupCourse = courses[0] || '';
    const topicsHere = t.topics.filter((x) => x.course === groupCourse);
    const live = Object.fromEntries(topicsHere.map((x) => [x.topic, x.approved || 0]));
    const list = g.groups.filter((x) => x.course === groupCourse);
    const liveCount = (grp) => grp.topics.reduce((a, name) => a + (live[name] || 0), 0);
    html(`
      <h1>Groups</h1>
      <p class="small muted">A group is a named set of topics, like “Test 1”. Students see groups as quick-pick buttons when they start practice, and can still adjust the topics after picking one. Renaming or merging a topic on the Topics tab updates any groups that use it.</p>
      <div class="tabs">${courses.map((c) => `<button data-course="${esc(c)}" class="${c === groupCourse ? 'active' : ''}">${esc(c)}</button>`).join('')}</div>
      <div id="msg"></div>
      <div class="row" style="margin-bottom:10px"><span class="small muted">${list.length} group${list.length === 1 ? '' : 's'} in ${esc(groupCourse)}</span><span class="spacer"></span><button class="small" id="newGroup">New group</button></div>
      <div id="editor"></div>
      <div id="groupList">${list.length ? list.map((grp) => {
        const n = liveCount(grp);
        return `<div class="card" data-id="${grp.id}">
          <div class="row"><strong>${esc(grp.name)}</strong>
            <span class="small muted">${grp.topics.length} topic${grp.topics.length === 1 ? '' : 's'} · ${n} live question${n === 1 ? '' : 's'}</span>
            ${n ? '' : '<span class="pill draft">hidden from students (no live questions)</span>'}
            <span class="spacer"></span><button class="small ghost" data-act="edit">Edit</button><button class="small ghost" data-act="delete">Delete</button></div>
          <div class="group-links" style="border:0;padding-top:0">${grp.topics.map((name) => name in live
            ? `<span class="chip">${esc(name)} <span class="muted">(${live[name]})</span></span>`
            : `<span class="chip stale" title="No questions in this topic any more">${esc(name)}</span>`).join('')}</div>
        </div>`;
      }).join('') : '<div class="card empty">No groups yet. Use “New group” to make one, e.g. “Test 1” with the topics on that test.</div>'}</div>`);
    const reload = () => groups().catch((e) => html(err(e)));
    const msg = (text, ok = true) => flash(document.getElementById('msg'), text, ok);
    document.querySelectorAll('[data-course]').forEach((b) => (b.onclick = () => { groupCourse = b.dataset.course; reload(); }));

    const openEditor = (grp) => {
      const box = document.getElementById('editor');
      const chosen = new Set(grp ? grp.topics : []);
      box.innerHTML = `<div class="card">
        <strong>${grp ? `Edit “${esc(grp.name)}”` : 'New group'}</strong>
        <label class="field" style="margin-top:8px"><span>Name</span><input type="text" id="gName" maxlength="60" value="${esc(grp ? grp.name : '')}" placeholder="e.g. Test 1"></label>
        <div class="field"><span>Topics in ${esc(groupCourse)}</span>
          <div class="row small" style="margin:2px 0 4px"><a href="#" id="gAll">All</a> · <a href="#" id="gNone">None</a><span class="spacer"></span><span class="muted" id="gCount"></span></div>
          <div id="gTopics">${topicsHere.map((x) => `<label class="check"><input type="checkbox" value="${esc(x.topic)}" ${chosen.has(x.topic) ? 'checked' : ''}> ${esc(x.topic)} <span class="muted small">(${x.approved || 0} live${x.draft ? `, ${x.draft} draft` : ''})</span></label>`).join('')}</div>
        </div>
        <div class="row"><button class="small" id="gSave">Save group</button><button class="small ghost" id="gCancel">Cancel</button></div>
      </div>`;
      const ticks = () => [...box.querySelectorAll('#gTopics input')];
      const count = () => {
        const sel = ticks().filter((b) => b.checked).map((b) => b.value);
        const n = sel.reduce((a, name) => a + (live[name] || 0), 0);
        document.getElementById('gCount').textContent = `${sel.length} topic${sel.length === 1 ? '' : 's'} · ${n} live question${n === 1 ? '' : 's'}`;
      };
      count();
      box.querySelector('#gTopics').onchange = count;
      document.getElementById('gAll').onclick = (e) => { e.preventDefault(); ticks().forEach((b) => (b.checked = true)); count(); };
      document.getElementById('gNone').onclick = (e) => { e.preventDefault(); ticks().forEach((b) => (b.checked = false)); count(); };
      document.getElementById('gCancel').onclick = () => { box.innerHTML = ''; };
      document.getElementById('gName').focus();
      document.getElementById('gSave').onclick = async () => {
        // Only topics that still exist are listed, so saving also drops any stale names.
        const body = { course: groupCourse, name: document.getElementById('gName').value.trim(), topics: ticks().filter((b) => b.checked).map((b) => b.value) };
        try {
          await api(grp ? `/api/admin/groups/${grp.id}` : '/api/admin/groups', { method: grp ? 'PUT' : 'POST', body });
          await groups();
          msg(`${grp ? 'Saved' : 'Created'} “${body.name}”.`);
        } catch (e) { flash(document.getElementById('msg'), e.message, false); }
      };
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    document.getElementById('newGroup').onclick = () => openEditor(null);
    document.getElementById('groupList').onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const grp = list.find((x) => String(x.id) === b.closest('[data-id]').dataset.id);
      if (b.dataset.act === 'edit') return openEditor(grp);
      if (b.dataset.act === 'delete') {
        if (!confirm(`Delete the group “${grp.name}”? Questions and topics aren't affected.`)) return;
        try { await api(`/api/admin/groups/${grp.id}`, { method: 'DELETE' }); await groups(); msg(`Deleted “${grp.name}”.`); }
        catch (e2) { msg(e2.message, false); }
      }
    };
  }

  // ---------- topics ----------
  let topicCache = null;
  async function fillTopicList() {
    try {
      if (!topicCache) topicCache = (await api('/api/admin/topics')).topics;
      const dl = document.getElementById('allTopics');
      if (dl) dl.innerHTML = [...new Set(topicCache.map((t) => t.topic))].sort().map((t) => `<option value="${esc(t)}">`).join('');
    } catch {}
  }
  let topicCourse = '';
  async function topics() {
    const r = await api('/api/admin/topics');
    topicCache = r.topics;
    const courses = [...new Set(r.topics.map((t) => t.course))];
    if (!courses.includes(topicCourse)) topicCourse = courses[0] || '';
    const list = r.topics.filter((t) => t.course === topicCourse);
    const sum = (k) => list.reduce((a, t) => a + (t[k] || 0), 0);
    html(`
      <h1>Topics</h1>
      <p class="small muted">Rename topics, merge several into one, or move them to another course. Renaming a topic to a name that already exists merges them. Students see these topics when they set up practice.</p>
      <div class="tabs">${courses.map((c) => `<button data-course="${esc(c)}" class="${c === topicCourse ? 'active' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="card">
        <div class="row"><strong>${esc(topicCourse)}</strong><span class="small muted">${list.length} topic${list.length === 1 ? '' : 's'} · ${sum('approved')} live · ${sum('draft')} drafts · ${sum('retired')} retired</span>
          <span class="spacer"></span><button class="small ghost" id="courseRename">Rename or merge course…</button></div>
        <div id="courseBox" hidden style="margin-top:10px">
          <label class="field"><span>New course name (pick an existing course to merge into it)</span>
            <input type="text" id="courseTo" list="courseList" value="${esc(topicCourse)}"></label>
          <datalist id="courseList">${courses.filter((c) => c !== topicCourse).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
          <div class="row"><button class="small" id="courseGo">Save</button><button class="small ghost" id="courseCancel">Cancel</button></div>
        </div>
      </div>
      <div class="bar row">
        <label class="check"><input type="checkbox" id="tAll"> Select all</label>
        <span class="small muted" id="tCount"></span>
        <span class="spacer"></span>
        <button class="small" id="mergeOpen">Merge / move selected…</button>
      </div>
      <div id="mergeBox" class="card" hidden>
        <strong>Move <span id="mergeN"></span> into one topic</strong>
        <div class="grid2" style="margin-top:8px">
          <label class="field"><span>Topic name</span><input type="text" id="mergeTo" list="allTopics" placeholder="e.g. Stress & coping"></label>
          <label class="field"><span>Course</span><select id="mergeCourse">${courses.map((c) => `<option ${c === topicCourse ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        </div>
        <div class="row"><button class="small" id="mergeGo">Move questions</button><button class="small ghost" id="mergeCancel">Cancel</button></div>
      </div>
      <datalist id="allTopics"></datalist>
      <div id="msg"></div>
      <div class="card table-wrap">
        ${list.length ? `<table><thead><tr><th></th><th>Topic</th><th class="num">Live</th><th class="num">Drafts</th><th class="num">Retired</th><th></th></tr></thead><tbody>
          ${list.map((t) => `<tr data-topic="${esc(t.topic)}">
            <td><input type="checkbox" class="tsel" value="${esc(t.topic)}"></td>
            <td class="tname">${esc(t.topic)}</td>
            <td class="num">${t.approved || 0}</td><td class="num">${t.draft || 0}</td><td class="num">${t.retired || 0}</td>
            <td class="row" style="justify-content:flex-end"><button class="small ghost" data-act="rename">Rename</button><button class="small ghost" data-act="view">View</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No topics in this course.</div>'}
      </div>`);
    fillTopicList();
    const reload = () => topics().catch((e) => html(err(e)));
    const msg = (t, ok = true) => flash(document.getElementById('msg'), t, ok);
    const selected = () => [...document.querySelectorAll('.tsel:checked')].map((b) => b.value);
    const updateCount = () => {
      const s = selected(), n = s.reduce((a, name) => a + (list.find((t) => t.topic === name)?.total || 0), 0);
      document.getElementById('tCount').textContent = s.length ? `${s.length} topic${s.length === 1 ? '' : 's'}, ${n} question${n === 1 ? '' : 's'}` : '';
      document.getElementById('mergeN').textContent = `${s.length} topic${s.length === 1 ? '' : 's'} (${n} question${n === 1 ? '' : 's'})`;
    };
    document.querySelectorAll('[data-course]').forEach((b) => (b.onclick = () => { topicCourse = b.dataset.course; reload(); }));
    document.getElementById('tAll').onchange = (e) => { document.querySelectorAll('.tsel').forEach((b) => (b.checked = e.target.checked)); updateCount(); };
    document.querySelector('.table-wrap').onchange = updateCount;

    // merge / move selected topics
    document.getElementById('mergeOpen').onclick = () => {
      if (!selected().length) return msg('Tick the topics you want to merge or move', false);
      updateCount(); document.getElementById('mergeBox').hidden = false; document.getElementById('mergeTo').focus();
    };
    document.getElementById('mergeCancel').onclick = () => { document.getElementById('mergeBox').hidden = true; };
    document.getElementById('mergeGo').onclick = async () => {
      const from = selected(), toTopic = document.getElementById('mergeTo').value.trim(), toCourse = document.getElementById('mergeCourse').value;
      if (!from.length) return msg('Tick the topics you want to merge or move', false);
      if (!toTopic) return msg('Enter the topic name to move them into', false);
      try {
        const res = await api('/api/admin/topics/move', { method: 'POST', body: { course: topicCourse, topics: from, toTopic, toCourse } });
        if (toCourse !== topicCourse) topicCourse = toCourse;
        await topics();
        msg(`Moved ${res.moved} question${res.moved === 1 ? '' : 's'} from ${from.length} topic${from.length === 1 ? '' : 's'} into “${res.topic}”.`);
      } catch (e) { msg(e.message, false); }
    };

    // rename one topic inline
    document.querySelector('.table-wrap').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const row = b.closest('tr'), name = row.dataset.topic;
      if (b.dataset.act === 'view') { qState.status = ''; qState.course = topicCourse; qState.topic = name; qState.q = ''; location.hash = '#questions'; return; }
      if (b.dataset.act === 'rename') {
        const cell = row.querySelector('.tname');
        cell.innerHTML = `<form class="row" style="gap:6px"><input type="text" value="${esc(name)}" list="allTopics" style="flex:1;min-width:160px"><button class="small">Save</button><button type="button" class="small ghost" data-cancel>Cancel</button></form>`;
        const form = cell.querySelector('form'), input = form.querySelector('input');
        input.focus(); input.select();
        form.querySelector('[data-cancel]').onclick = () => { cell.textContent = name; };
        form.onsubmit = async (ev) => {
          ev.preventDefault();
          const to = input.value.trim();
          if (!to || to === name) { cell.textContent = name; return; }
          const existing = list.find((t) => t.topic === to);
          if (existing && !confirm(`“${to}” already exists. Merge “${name}” into it?`)) return;
          try {
            const res = await api('/api/admin/topics/move', { method: 'POST', body: { course: topicCourse, topics: [name], toTopic: to } });
            await topics();
            msg(existing ? `Merged “${name}” into “${to}” (${res.moved} questions).` : `Renamed “${name}” to “${to}”.`);
          } catch (e2) { msg(e2.message, false); }
        };
      }
    };

    // rename / merge course
    document.getElementById('courseRename').onclick = () => { document.getElementById('courseBox').hidden = false; document.getElementById('courseTo').select(); };
    document.getElementById('courseCancel').onclick = () => { document.getElementById('courseBox').hidden = true; };
    document.getElementById('courseGo').onclick = async () => {
      const to = document.getElementById('courseTo').value.trim();
      if (!to || to === topicCourse) { document.getElementById('courseBox').hidden = true; return; }
      const merging = courses.includes(to);
      if (merging && !confirm(`Merge all of “${topicCourse}” into “${to}”? Topics keep their names, so you can tidy them up afterwards.`)) return;
      try {
        const res = await api('/api/admin/courses/rename', { method: 'POST', body: { from: topicCourse, to } });
        const old = topicCourse; topicCourse = to;
        await topics();
        msg(merging ? `Merged “${old}” into “${to}” (${res.moved} questions).` : `Renamed course to “${to}”.`);
      } catch (e) { msg(e.message, false); }
    };
  }

  // ---------- import ----------
  const PROMPT = `Using ONLY the content in the attached lecture deck(s), write multiple-choice questions for second-year Practical Nursing students. Provide the response as a downloadable .json file.

Rules:
- 4 options each, exactly one clearly correct answer, plausible wrong answers
- Mix recall and application (patient scenario) questions
- Vary which letter is correct
- Rationale: 1–3 sentences explaining why the answer is right (and why a tempting wrong answer is wrong, if useful)
- Source: deck title and slide number the question comes from
- Topic: use the file name of the deck the question comes from, exactly as it appears, without the file extension (for example, "Week 6 Pain Part 1.pptx" becomes "Week 6 Pain Part 1"). Every question from the same file must have exactly the same topic. Do NOT create sub-topics from slide headings or sections.

The .json file must contain ONLY valid JSON in exactly this format, no other text:
{"course": "Pharmacology", "questions": [
  {"topic": "Week 6 Pain Part 1", "stem": "Question text?", "options": ["A text", "B text", "C text", "D text"], "answer": "B", "rationale": "Why B is correct.", "source": "Week 6 Pain Part 1, slide 14"}
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
      </div>
      <h2>Recent imports</h2>
      <div id="importList" class="card"><p class="muted small">Loading…</p></div>`);
    loadImports();
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
        document.getElementById('preview').innerHTML = `<div class="notice good">Imported ${r.imported} questions as drafts. <a href="#questions">Review them →</a> Not what you expected? Undo it under Recent imports below.</div>`;
        document.getElementById('json').value = '';
        qState.status = 'draft'; topicCache = null;
        loadImports();
      } catch (e2) { document.getElementById('preview').innerHTML = err(e2); e.target.disabled = false; }
    };
  }

  async function loadImports() {
    const box = document.getElementById('importList');
    if (!box) return;
    let r;
    try { r = await api('/api/admin/imports'); } catch (e) { box.innerHTML = err(e); return; }
    if (!r.imports.length) { box.innerHTML = '<div class="empty">No imports yet.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Uploaded</th><th>Course</th><th class="num">Questions</th><th class="num">Topics</th><th>Used by students</th><th></th></tr></thead><tbody>
      ${r.imports.map((i, k) => {
        const used = [i.answers && `${i.answers} answer${i.answers === 1 ? '' : 's'}`, i.flags && `${i.flags} flag${i.flags === 1 ? '' : 's'}`, i.inRanked && `${i.inRanked} in ranked test`].filter(Boolean).join(', ');
        return `<tr data-imp="${i.id}">
          <td class="small">${fmtDate(i.created_at)}${k === 0 ? ' <span class="pill">latest</span>' : ''}</td>
          <td class="small">${esc(i.courses)}</td>
          <td class="num">${i.remaining}${i.remaining !== i.uploaded ? `<span class="small muted"> of ${i.uploaded}</span>` : ''}</td>
          <td class="num">${i.topics}</td>
          <td class="small ${used ? '' : 'muted'}">${used || 'not yet'}${i.edited ? `<div class="muted">${i.edited} edited since upload</div>` : ''}</td>
          <td><button class="small danger" data-undo="${i.id}" ${i.inRanked ? 'disabled title="Some of these questions are in a ranked test"' : ''}>Undo</button></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">Undo permanently deletes that upload's questions, along with any practice history, flags and update notices attached to them.</p>`;
    box.onclick = async (e) => {
      const b = e.target.closest('[data-undo]'); if (!b) return;
      const i = r.imports.find((x) => x.id === +b.dataset.undo);
      const warn = [
        i.answers && `• students have answered these ${i.answers} time${i.answers === 1 ? '' : 's'} (that practice history will be removed)`,
        i.flags && `• ${i.flags} flag${i.flags === 1 ? '' : 's'} will be removed`,
        i.edited && `• you've edited ${i.edited} of these questions since uploading`,
      ].filter(Boolean).join('\n');
      if (!confirm(`Undo the ${i.courses} upload from ${fmtDate(i.created_at)}?\n\nThis permanently deletes its ${i.remaining} question${i.remaining === 1 ? '' : 's'} (${i.topics} topic${i.topics === 1 ? '' : 's'}).${warn ? '\n\n' + warn : ''}`)) return;
      b.disabled = true;
      try {
        const res = await api(`/api/admin/imports/${i.id}/undo`, { method: 'POST' });
        topicCache = null;
        await loadImports();
        document.getElementById('importList').insertAdjacentHTML('afterbegin', `<div class="notice good">Removed ${res.removed} question${res.removed === 1 ? '' : 's'}.</div>`);
      } catch (e2) { b.disabled = false; box.insertAdjacentHTML('afterbegin', err(e2)); }
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
    const [r, g] = await Promise.all([api('/api/admin/questions?status=approved'), api('/api/admin/groups')]);
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
        <div class="field" id="groupWrap" style="margin:6px 0 0"><span>Groups <span class="muted">(pick one or more to limit the questions to their topics)</span></span>
          <div class="seg wrap" id="groupSeg"></div>
          <div class="small muted" id="groupNote" style="margin-top:4px"></div>
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
    const groupSeg = document.getElementById('groupSeg');
    const selectedGroups = new Set();
    const count = () => {
      const shown = [...picker.querySelectorAll('[data-topic]')].filter((el) => el.style.display !== 'none').length;
      document.getElementById('selCount').textContent = `(${picker.querySelectorAll('input:checked').length} selected · ${shown} shown)`;
    };
    // Topics allowed by the chosen groups (null = no group chosen, so every topic is allowed).
    const groupTopics = () => {
      if (!selectedGroups.size) return null;
      return new Set(g.groups.filter((x) => selectedGroups.has(x.id)).flatMap((x) => x.topics));
    };
    const applyFilter = () => {
      const allowed = groupTopics();
      picker.querySelectorAll('[data-topic]').forEach((el) => {
        const t = el.dataset.topic;
        el.style.display = (!allowed || allowed.has(t)) && (!topicF.value || t === topicF.value) ? '' : 'none';
      });
      const chosen = g.groups.filter((x) => selectedGroups.has(x.id));
      document.getElementById('groupNote').textContent = chosen.length
        ? `Topics: ${[...allowed].join(', ')}` : '';
      count();
    };
    const renderTopicFilter = () => {
      const allowed = groupTopics();
      const qs = r.questions.filter((q) => q.course === courseSel.value && (!allowed || allowed.has(q.topic)));
      const topics = [...new Set(qs.map((q) => q.topic))];
      if (topicF.value && !topics.includes(topicF.value)) topicF.value = '';
      const keep = topicF.value;
      topicF.innerHTML = `<option value="">All topics</option>${topics.map((t) => `<option ${t === keep ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
    };
    const renderGroups = () => {
      const list = g.groups.filter((x) => x.course === courseSel.value);
      document.getElementById('groupWrap').style.display = list.length ? '' : 'none';
      groupSeg.innerHTML = list.map((x) => `<button type="button" role="checkbox" data-group="${x.id}" aria-checked="${selectedGroups.has(x.id)}" class="${selectedGroups.has(x.id) ? 'on' : ''}">${esc(x.name)}</button>`).join('');
    };
    groupSeg.onclick = (e) => {
      const b = e.target.closest('[data-group]'); if (!b) return;
      const id = +b.dataset.group;
      if (selectedGroups.has(id)) selectedGroups.delete(id); else selectedGroups.add(id);
      renderGroups(); renderTopicFilter(); applyFilter();
    };
    const renderPicker = () => {
      selectedGroups.clear();
      const qs = r.questions.filter((q) => q.course === courseSel.value);
      picker.innerHTML = qs.map((q) => `<label class="check" data-topic="${esc(q.topic)}"><input type="checkbox" value="${q.id}"><span><span class="small muted">#${q.id} · ${esc(q.topic)}${q.inRanked ? ' · used in another ranked test' : ''}</span><br>${esc(q.stem)}</span></label>`).join('') || '<div class="empty">No approved questions for this course.</div>';
      renderGroups(); renderTopicFilter(); applyFilter();
    };
    courseSel.onchange = renderPicker;
    topicF.onchange = applyFilter;
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
      <p class="small muted">Study codes aren't stored and can't be shown. Students can see their own code on their Profile page. If someone loses theirs, use <strong>New code</strong> to give them a replacement; their progress stays. You can also rename a nickname, hide someone from leaderboards, or delete them entirely. "Opted out" means the student chose to stay off leaderboards.</p>
      <div id="msg"></div>
      <div id="newCode"></div>
      <div class="card table-wrap">
        ${r.players.length ? `<table><thead><tr><th>Nickname</th><th>Joined</th><th class="num">Seen</th><th class="num">Practice</th><th class="num">Ranked</th><th></th></tr></thead><tbody>
        ${r.players.map((p) => `<tr data-id="${p.id}"><td>${esc(p.nickname)}${p.hidden ? ' <span class="pill closed">hidden</span>' : ''}${p.optedOut ? ' <span class="pill">opted out</span>' : ''}</td>
          <td class="small">${fmtDate(p.created_at)}</td><td class="num">${p.questionsSeen}</td><td class="num">${p.practiceAnswers}</td><td class="num">${p.rankedTests}</td>
          <td class="row"><button class="small secondary" data-act="rename">Rename</button>
          <button class="small secondary" data-act="code" data-nick="${esc(p.nickname)}">New code</button>
          <button class="small ghost" data-act="hide" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Unhide' : 'Hide'}</button>
          <button class="small danger" data-act="delete" data-nick="${esc(p.nickname)}">Delete</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No players yet.</div>'}
      </div>`);
    document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const id = b.closest('tr').dataset.id;
      try {
        if (b.dataset.act === 'rename') {
          const n = prompt('New nickname'); if (!n) return;
          await api(`/api/admin/players/${id}`, { method: 'PUT', body: { nickname: n } });
        } else if (b.dataset.act === 'code') {
          const nick = b.dataset.nick;
          if (!confirm(`Give ${nick} a new study code?\n\nTheir old code will stop working on every device. Their progress, scores and nickname stay the same.`)) return;
          const r = await api(`/api/admin/players/${id}/new-code`, { method: 'POST' });
          const box = document.getElementById('newCode');
          box.innerHTML = `<div class="card"><strong>New study code for ${esc(r.nickname)}</strong>
            <p class="small muted" style="margin:4px 0 0">Pass this on to them now. It won't be shown again.</p>
            <div class="code-box">${esc(r.code)}</div>
            <div class="row"><button class="small secondary" id="copyCode">Copy code</button><button class="small secondary" id="copyLink">Copy sign-in link</button><button class="small ghost" id="doneCode">Done</button></div>
            <p class="small muted" style="margin:6px 0 0">The sign-in link signs them straight in when they open it.</p></div>`;
          document.getElementById('copyCode').onclick = async (e) => { try { await navigator.clipboard.writeText(r.code); e.target.textContent = 'Copied'; } catch {} };
          const link = `${location.origin}/#/code/${encodeURIComponent(r.code)}`;
          document.getElementById('copyLink').onclick = async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Link copied'; } catch { prompt('Copy the sign-in link:', link); } };
          document.getElementById('doneCode').onclick = () => { box.innerHTML = ''; };
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        } else if (b.dataset.act === 'delete') {
          const nick = b.dataset.nick;
          if (!confirm(`Permanently delete ${nick}?\n\nThis removes their study code, nickname, practice history and ranked test attempts. Their code will stop working. Any questions they flagged stay, but become anonymous.\n\nThis can't be undone.`)) return;
          const r = await api(`/api/admin/players/${id}`, { method: 'DELETE' });
          await players();
          flash(document.getElementById('msg'), `Deleted ${r.deleted}: ${r.practiceAnswers} practice answers and ${r.rankedAttempts} ranked attempts removed.`);
          return;
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
