// ─── Page routing and authentication ───
// ── State ──────────────────────────────────────────────────
const API = '/api';   // proxied by nginx to backend:3000
let session = null;   // { sessionId, user }

// ── Init ───────────────────────────────────────────────────
window.onload = () => {
  const saved = localStorage.getItem('ss_session');
  if (saved) {
    session = JSON.parse(saved);
    setLoggedIn(session.user);
    showPage('courses');
  } else {
    showPage('home');
  }
};

// ── Page routing ────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  // Side effects per page
  if (name === 'courses') loadCourses();
  if (name === 'dashboard') loadDashboard();
  if (name === 'analytics') loadAnalytics();
}

// ── Auth ────────────────────────────────────────────────────
async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const skillsRaw = document.getElementById('reg-skills').value;
  const skills = skillsRaw.split(',').map(s => s.trim()).filter(Boolean);

  try {
    const data = await api('POST', '/auth/register', { username, email, password, skills });
    session = { sessionId: data.sessionId, user: data.user };
    localStorage.setItem('ss_session', JSON.stringify(session));
    setLoggedIn(data.user);
    showPage('courses');
  } catch (e) {
    showError('register-error', e.message);
  }
}

async function login() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const data = await api('POST', '/auth/login', { email, password });
    session = { sessionId: data.sessionId, user: data.user };
    localStorage.setItem('ss_session', JSON.stringify(session));
    setLoggedIn(data.user);
    showPage('dashboard');
  } catch (e) {
    showError('login-error', e.message);
  }
}

async function logout() {
  if (session) {
    await api('POST', '/auth/logout').catch(() => {});
  }
  session = null;
  localStorage.removeItem('ss_session');
  document.getElementById('nav-auth').classList.remove('hidden');
  document.getElementById('nav-user').classList.add('hidden');
  showPage('home');
}

function setLoggedIn(user) {
  document.getElementById('nav-auth').classList.add('hidden');
  document.getElementById('nav-user').classList.remove('hidden');
  document.getElementById('nav-username-label').textContent = user.username;
}

// ── Courses ─────────────────────────────────────────────────
async function loadCourses() {
  const grid = document.getElementById('courses-grid');
  const modeLabel = document.getElementById('search-mode-label');
  modeLabel.classList.add('hidden');
  grid.innerHTML = '<div class="loading">Loading courses…</div>';

  try {
    const courses = await api('GET', '/courses');
    renderCourses(courses);
  } catch (e) {
    grid.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

async function vectorSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return loadCourses();

  const grid = document.getElementById('courses-grid');
  const modeLabel = document.getElementById('search-mode-label');
  grid.innerHTML = '<div class="loading">Searching with AI…</div>';
  modeLabel.classList.remove('hidden');

  try {
    const data = await api('GET', `/courses/search?q=${encodeURIComponent(q)}`);
    renderCourses(data.results, true);
  } catch (e) {
    grid.innerHTML = `<div class="loading">Search error: ${e.message}</div>`;
  }
}

function renderCourses(courses, showScore = false) {
  const grid = document.getElementById('courses-grid');
  if (!courses || courses.length === 0) {
    grid.innerHTML = '<div class="empty">No courses found.</div>';
    return;
  }

  grid.innerHTML = courses.map(c => `
    <div class="course-card">
      <div class="course-title">${esc(c.title)}</div>
      <div class="course-desc">${esc((c.description || '').slice(0, 110))}…</div>
      <div class="course-meta">
        <span class="badge ${c.difficulty}">${c.difficulty}</span>
        ${(c.tags || []).slice(0, 2).map(t => `<span class="badge">${esc(t)}</span>`).join('')}
        ${showScore && c.score ? `<span class="badge score-badge">Score: ${(c.score * 100).toFixed(0)}%</span>` : ''}
      </div>
      <div class="enroll-count">${c.enrollmentCount || 0} enrolled · ${c.duration || 0} min</div>
      <div class="course-actions">
        ${session
          ? `<button class="btn btn-primary btn-sm" onclick="enroll('${c._id}', this)">Enroll</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="showPage('login')">Login to enroll</button>`
        }
      </div>
    </div>
  `).join('');
}

async function enroll(courseId, btn) {
  if (!session) return showPage('login');
  btn.disabled = true; btn.textContent = 'Enrolling…';
  try {
    await api('POST', `/courses/${courseId}/enroll`);
    btn.textContent = '✓ Enrolled';
    btn.className = 'btn btn-success btn-sm';
  } catch (e) {
    btn.textContent = e.message.includes('Already') ? '✓ Enrolled' : 'Error';
    btn.disabled = false;
  }
}

// ── Dashboard ───────────────────────────────────────────────
async function loadDashboard() {
  if (!session) { showPage('login'); return; }

  // Load in parallel
  Promise.all([
    loadMyProgress(),
    loadLeaderboard(),
    loadStats(),
    loadRec('courses'),
  ]);
}

async function loadMyProgress() {
  const el = document.getElementById('my-progress-list');
  const rankEl = document.getElementById('my-rank-display');
  try {
    const data = await api('GET', '/dashboard/my-stats');
    const { progress, rank } = data;

    rankEl.innerHTML = rank.rank
      ? `<div class="rank-display">#${rank.rank}</div><div class="rank-sub">${rank.points} pts</div>`
      : '<div class="rank-display">–</div>';

    if (!progress || progress.length === 0) {
      el.innerHTML = '<div class="empty">No enrollments yet. Go enroll in a course!</div>';
      return;
    }

    el.innerHTML = progress.map(p => `
      <div class="progress-item">
        <div class="progress-title">${esc(p.title)}</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${p.percentage}%"></div>
        </div>
        <div class="progress-meta">
          <span class="badge ${p.difficulty}">${p.difficulty}</span>
          <span>${p.percentage}% complete</span>
        </div>
        ${p.percentage < 100 ? `
          <div style="margin-top:6px">
            <input type="range" min="0" max="100" value="${p.percentage}" style="width:120px"
              onchange="updateProgress('${p.courseId}', this.value, this)" />
          </div>` : '<div style="font-size:12px;color:var(--success);margin-top:4px">✓ Completed</div>'
        }
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

async function updateProgress(courseId, pct, slider) {
  try {
    await api('PATCH', `/courses/${courseId}/progress`, { percentage: parseInt(pct) });
    loadMyProgress();
  } catch (e) { console.error(e); }
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  try {
    const lb = await api('GET', '/dashboard/leaderboard');
    const medals = ['gold', 'silver', 'bronze'];
    el.innerHTML = lb.map(e => `
      <div class="leaderboard-item">
        <span class="lb-rank ${medals[e.rank - 1] || ''}">#${e.rank}</span>
        <span class="lb-name">${esc(e.username)}</span>
        <span class="lb-pts">${e.points} pts</span>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

async function loadStats() {
  const el = document.getElementById('stats-display');
  try {
    const s = await api('GET', '/dashboard/stats');
    el.innerHTML = `
      <div class="stat-box"><div class="stat-num">${s.users}</div><div class="stat-label">Learners</div></div>
      <div class="stat-box"><div class="stat-num">${s.courses}</div><div class="stat-label">Courses</div></div>
      <div class="stat-box"><div class="stat-num">${s.enrollments}</div><div class="stat-label">Enrollments</div></div>
      <div class="stat-box"><div class="stat-num">${s.completions}</div><div class="stat-label">Completions</div></div>
    `;
  } catch (e) { el.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

async function loadRec(type, btn) {
  if (btn) {
    document.querySelectorAll('.rec-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  if (!session) return;

  const el = document.getElementById('rec-list');
  el.innerHTML = '<div class="loading">Loading…</div>';

  try {
    const data = await api('GET', `/recommendations/${type}`);
    const items = data.recommendations;

    if (!items || items.length === 0) {
      el.innerHTML = '<div class="empty">Follow more users to get recommendations!</div>';
      return;
    }

    if (type === 'courses') {
      el.innerHTML = items.map(r => `
        <div class="rec-item">
          <div>
            <div class="rec-name">${esc(r.title)}</div>
            <div class="rec-meta">${r.relatedSkills?.join(', ')} · ${r.endorsedByPeers} peers enrolled</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="enroll('${r.id}', this)">Enroll</button>
        </div>
      `).join('');
    } else if (type === 'friends') {
      el.innerHTML = items.map(r => `
        <div class="rec-item">
          <div>
            <div class="rec-name">${esc(r.username)}</div>
            <div class="rec-meta">${r.mutualConnections} mutual connection${r.mutualConnections !== 1 ? 's' : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="follow('${r.id}', this)">Follow</button>
        </div>
      `).join('');
    } else if (type === 'skills') {
      el.innerHTML = items.map(r => `
        <div class="rec-item">
          <div>
            <div class="rec-name">${esc(r.skill)}</div>
            <div class="rec-meta">${r.frequency} users with this skill</div>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    el.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

async function follow(userId, btn) {
  if (!session) return showPage('login');
  btn.disabled = true;
  try {
    await api('POST', `/users/follow/${userId}`);
    btn.textContent = '✓ Following';
    btn.className = 'btn btn-success btn-sm';
  } catch (e) { btn.disabled = false; }
}

// ── Analytics ────────────────────────────────────────────────
async function loadAnalytics() {
  const popEl    = document.getElementById('popular-courses-table');
  const progEl   = document.getElementById('user-progress-table');

  try {
    const pop = await api('GET', '/dashboard/popular-courses');
    popEl.innerHTML = `
      <table>
        <thead><tr><th>Course</th><th>Difficulty</th><th>Enrollments</th><th>Completion %</th></tr></thead>
        <tbody>${pop.map(c => `
          <tr>
            <td>${esc(c.title)}</td>
            <td><span class="badge ${c.difficulty}">${c.difficulty}</span></td>
            <td>${c.totalEnrollments}</td>
            <td>${c.completionRate}%</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { popEl.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }

  try {
    const prog = await api('GET', '/dashboard/user-progress-summary');
    progEl.innerHTML = `
      <table>
        <thead><tr><th>User</th><th>Courses</th><th>Avg progress</th><th>Completed</th></tr></thead>
        <tbody>${prog.map(u => `
          <tr>
            <td>${esc(u.username)}</td>
            <td>${u.totalCourses}</td>
            <td>
              <div class="progress-bar-bg" style="min-width:80px">
                <div class="progress-bar-fill" style="width:${u.avgProgress}%"></div>
              </div>
              ${u.avgProgress}%
            </td>
            <td>${u.completedCourses}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { progEl.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

// ── API Helper ───────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (session?.sessionId) headers['x-session-id'] = session.sessionId;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Utilities ────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
