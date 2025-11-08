// Tabs
const tabs = [
  { id: 'auth', label: 'Login' },
  { id: 'teams', label: 'Teams' },
  { id: 'gigs', label: 'Gigs' },
  { id: 'mentors', label: 'Mentors' },
  { id: 'checkin', label: 'Check-in' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'judging', label: 'Judging' },
  { id: 'space', label: 'HackSPU Space' },
];

let state = {
  user: null,
  teams: [],
  gigs: [],
  mentors: [],
  leaderboard: [],
  broadcasts: [],
  ws: null
};

function el(html){ const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

function setTabs(active='auth'){
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = '';
  tabs.forEach(t => {
    const btn = el(`<button class="tab ${t.id===active?'active':''}" data-id="${t.id}">${t.label}</button>`);
    btn.onclick = () => { setTabs(t.id); render(t.id); };
    tabsEl.appendChild(btn);
  });
}

async function api(path, opts={}){
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if(!res.ok){ const txt = await res.text(); throw new Error(txt || res.statusText); }
  return res.json();
}

// WebSocket for live leaderboard
function connectWS(){
  try {
    const wsURL = API_BASE.replace(/^http/,'ws') + '/ws';
    const ws = new WebSocket(wsURL);
    ws.onopen = () => { state.ws = ws; };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if(msg.type === 'leaderboard'){
          state.leaderboard = msg.data;
          if(document.getElementById('lbRows')) drawLeaderboardRows();
        }
      } catch(e){}
    };
    ws.onclose = () => { state.ws = null; setTimeout(connectWS, 1500); };
  } catch(e){ setTimeout(connectWS, 3000); }
}

// Views
async function viewAuth(){
  const v = el(`<div class="card">
    <h2>Welcome to OnTap SPU</h2>
    <p>Use a mock email to log in and start the demo. No passwords needed.</p>
    <label>Email</label>
    <input id="email" placeholder="you@saintpeters.edu" value="judge@saintpeters.edu">
    <div style="margin-top:10px;display:flex;gap:8px">
      <button class="primary" id="loginBtn">Login</button>
      <span id="loginStatus"></span>
    </div>
  </div>`);
  v.querySelector('#loginBtn').onclick = async () => {
    const email = v.querySelector('#email').value.trim();
    try{
      const res = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email }) });
      state.user = res;
      v.querySelector('#loginStatus').textContent = 'Logged in ✅';
      setTabs('teams'); render('teams');
    }catch(e){ alert(e.message); }
  }
  return v;
}

async function refreshTeams(){ state.teams = await api('/api/teams'); }

async function viewTeams(){
  await refreshTeams();
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>Create Team</h3>
        <label>Team name</label>
        <input id="teamName" placeholder="OnTap Innovators">
        <button class="primary" id="createTeam">Create</button>
      </div>
      <div>
        <h3>Join Team</h3>
        <label>Team</label>
        <select id="teamSelect"></select>
        <button id="joinTeam">Join</button>
      </div>
    </div>
    <div style="margin-top:16px">
      <h3>All Teams</h3>
      <table class="table" id="teamTable">
        <thead><tr><th>Name</th><th>Members</th><th>Created</th><th>ID</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>`);

  const sel = v.querySelector('#teamSelect');
  state.teams.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); });

  function redraw(){
    const tbody = v.querySelector('#teamTable tbody');
    tbody.innerHTML = '';
    state.teams.forEach(t => {
      const tr = el(`<tr><td>${t.name}</td><td>${t.members.length}</td><td>${new Date(t.created_at*1000).toLocaleTimeString()}</td><td><code>${t.id}</code></td></tr>`);
      tbody.appendChild(tr);
    });
  }
  redraw();

  v.querySelector('#createTeam').onclick = async () => {
    const team_name = v.querySelector('#teamName').value.trim() || `Team-${Math.floor(Math.random()*999)}`;
    await api('/api/teams/create', { method:'POST', body: JSON.stringify({ team_name })});
    await refreshTeams(); redraw();
    sel.innerHTML = ''; state.teams.forEach(t => { const o = document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o); });
  };
  v.querySelector('#joinTeam').onclick = async () => {
    const team_id = sel.value;
    await api('/api/teams/join', { method:'POST', body: JSON.stringify({ team_id })});
    await refreshTeams(); redraw();
  };
  return v;
}

async function viewGigs(){
  state.gigs = await api('/api/gigs');
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>Add Gig</h3>
        <label>Title</label><input id="gTitle" placeholder="Food run, Design help, Debugging">
        <label>Description</label><textarea id="gDesc" rows="3" placeholder="Describe the micro-task"></textarea>
        <label>Reward Points</label><input id="gPts" type="number" value="10">
        <button class="primary" id="addGig">Post Gig</button>
      </div>
      <div>
        <h3>Available Gigs</h3>
        <div id="gigList"></div>
      </div>
    </div>
  </div>`);

  function redraw(){
    const list = v.querySelector('#gigList');
    list.innerHTML = '';
    state.gigs.slice().reverse().forEach(g => {
      const item = el(`<div class="card"><b>${g.title}</b><div>${g.description}</div><div class="success">+${g.reward_points} pts</div><div style="font-size:12px;opacity:.8">#${g.id}</div></div>`);
      list.appendChild(item);
    });
  }
  redraw();

  v.querySelector('#addGig').onclick = async () => {
    const title = v.querySelector('#gTitle').value.trim();
    const description = v.querySelector('#gDesc').value.trim();
    const reward_points = parseInt(v.querySelector('#gPts').value||'10', 10);
    const g = await api('/api/gigs', { method:'POST', body: JSON.stringify({ title, description, reward_points }) });
    state.gigs.push(g); redraw();
  };

  return v;
}

async function viewMentors(){
  state.mentors = await api('/api/mentors');
  await refreshTeams();
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>Book Mentor</h3>
        <label>Team</label><select id="team"></select>
        <label>Mentor</label><select id="mentor"></select>
        <label>Slot</label><select id="slot"></select>
        <button class="primary" id="book">Book</button>
        <div id="status"></div>
      </div>
      <div>
        <h3>Mentors</h3>
        <div id="list"></div>
      </div>
    </div>
  </div>`);

  const teamSel = v.querySelector('#team');
  state.teams.forEach(t => { const o = document.createElement('option'); o.value=t.id; o.textContent=t.name; teamSel.appendChild(o); });

  const mentorSel = v.querySelector('#mentor');
  const slotSel = v.querySelector('#slot');
  function fillMentors(){
    mentorSel.innerHTML = '';
    state.mentors.forEach(m => { const o = document.createElement('option'); o.value=m.id; o.textContent=m.name; mentorSel.appendChild(o); });
    fillSlots();
  }
  function fillSlots(){
    slotSel.innerHTML = '';
    const m = state.mentors.find(x => x.id===mentorSel.value) || state.mentors[0];
    (m?.slots||[]).forEach(s => { const o = document.createElement('option'); o.value=s; o.textContent=s; slotSel.appendChild(o); });
  }
  mentorSel.onchange = fillSlots;
  fillMentors();

  function drawMentorCards(){
    const list = v.querySelector('#list'); list.innerHTML='';
    state.mentors.forEach(m => {
      list.appendChild(el(`<div class="card"><b>${m.name}</b><div>${m.skills.join(', ')}</div><div>Slots: ${m.slots.join(' • ')}</div></div>`));
    });
  }
  drawMentorCards();

  v.querySelector('#book').onclick = async () => {
    const team_id = teamSel.value, mentor_id = mentorSel.value, slot = slotSel.value;
    const r = await api('/api/mentors/book', { method:'POST', body: JSON.stringify({ team_id, mentor_id, slot }) });
    v.querySelector('#status').textContent = `Booked ✅ Ref: ${r.booking_id}`;
  };

  return v;
}

async function viewCheckin(){
  await refreshTeams();
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>QR Check-in</h3>
        <label>Team</label><select id="team"></select>
        <label>Code</label><input id="code" placeholder="HACKSPU2025" value="HACKSPU2025">
        <div class="qrbox"><button class="primary" id="gen">Generate QR</button><div id="qr"></div></div>
        <div style="height:8px"></div>
        <button id="do">Simulate Check-in</button>
        <div id="status"></div>
      </div>
      <div>
        <h3>Award Points</h3>
        <label>Team</label><select id="team2"></select>
        <label>Points</label><input id="pts" type="number" value="10">
        <label>Reason</label><input id="reason" placeholder="Milestone achieved">
        <button id="award">Award</button>
        <div id="awardStatus"></div>
      </div>
    </div>
  </div>`);

  const teamSel = v.querySelector('#team');
  const teamSel2 = v.querySelector('#team2');
  state.teams.forEach(t => {
    const o1 = document.createElement('option'); o1.value=t.id; o1.textContent=t.name; teamSel.appendChild(o1);
    const o2 = document.createElement('option'); o2.value=t.id; o2.textContent=t.name; teamSel2.appendChild(o2);
  });

  v.querySelector('#gen').onclick = () => {
    const team_id = teamSel.value, code = v.querySelector('#code').value.trim();
    const payload = JSON.stringify({ team_id, code });
    makeQR(payload, 180, v.querySelector('#qr'));
  };

  v.querySelector('#do').onclick = async () => {
    const team_id = teamSel.value, code = v.querySelector('#code').value;
    await api('/api/checkin', { method:'POST', body: JSON.stringify({ team_id, code }) });
    v.querySelector('#status').textContent = `Checked in ✅ (${new Date().toLocaleTimeString()})`;
  };

  v.querySelector('#award').onclick = async () => {
    const team_id = teamSel2.value, points = parseInt(v.querySelector('#pts').value||'10',10);
    const reason = v.querySelector('#reason').value;
    const r = await api('/api/points/award', { method:'POST', body: JSON.stringify({ team_id, points, reason }) });
    v.querySelector('#awardStatus').textContent = `Awarded. Total points now = ${r.total_points}`;
  };

  return v;
}

function drawLeaderboardRows(){
  const rows = document.getElementById('lbRows');
  if(!rows) return;
  rows.innerHTML = '';
  state.leaderboard.forEach((r,i) => {
    rows.appendChild(el(`<tr><td>${i+1}</td><td>${r.team_name}</td><td><b>${r.points}</b></td><td><code>${r.team_id}</code></td></tr>`));
  });
}

async function viewLeaderboard(){
  state.leaderboard = await api('/api/leaderboard');
  const v = el(`<div class="card">
    <h3>Live Leaderboard</h3>
    <table class="table"><thead><tr><th>#</th><th>Team</th><th>Points</th><th>ID</th></tr></thead><tbody id="lbRows"></tbody></table>
  </div>`);
  drawLeaderboardRows();
  return v;
}

async function viewJudging(){
  await refreshTeams();
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>Submit Score</h3>
        <label>Judge Name</label><input id="judge" placeholder="Your Name" value="${(state.user?.email)||''}">
        <label>Team</label><select id="team"></select>
        <label>Category</label>
        <select id="cat">
          <option value="Innovation">Innovation</option>
          <option value="Impact">Impact</option>
          <option value="Technical">Technical</option>
          <option value="Design">Design</option>
          <option value="Pitch">Pitch</option>
        </select>
        <label>Score (0-10)</label><input id="sc" type="number" min="0" max="10" value="8">
        <button class="primary" id="submit">Submit</button>
        <div id="status"></div>
        <p class="success" style="font-size:12px;margin-top:8px">Demo behavior: each submitted score adds to team points and updates leaderboard in real time.</p>
      </div>
      <div>
        <h3>Summary</h3>
        <div id="sum"></div>
      </div>
    </div>
  </div>`);

  const teamSel = v.querySelector('#team');
  state.teams.forEach(t => { const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; teamSel.appendChild(o); });

  async function loadSummary(){
    const s = await api('/api/judging/summary');
    const box = v.querySelector('#sum'); box.innerHTML = '';
    const keys = Object.keys(s);
    if(!keys.length){ box.textContent = 'No scores yet.'; return; }
    keys.forEach(tid => {
      const team = state.teams.find(x => x.id===tid);
      const name = team ? team.name : tid;
      const avg = s[tid].avg.toFixed(2);
      let cats = Object.entries(s[tid].by_category).map(([c,v])=>`${c}: ${v.avg.toFixed(2)} (${v.count})`).join(' • ');
      box.appendChild(el(`<div class="card"><b>${name}</b><div>Avg: ${avg}</div><div>${cats}</div></div>`));
    });
  }
  await loadSummary();

  v.querySelector('#submit').onclick = async () => {
    const judge = v.querySelector('#judge').value.trim() || 'Judge';
    const team_id = teamSel.value;
    const category = v.querySelector('#cat').value;
    const score = Math.max(0, Math.min(10, parseInt(v.querySelector('#sc').value||'0',10)));
    await api('/api/judging/score', { method:'POST', body: JSON.stringify({ team_id, judge, category, score }) });
    v.querySelector('#status').textContent = 'Score submitted ✅';
    await loadSummary();
  };

  return v;
}

async function viewSpace(){
  state.broadcasts = await api('/api/broadcasts');
  const v = el(`<div class="card">
    <div class="row">
      <div>
        <h3>Broadcast update</h3>
        <label>Message</label><input id="msg" placeholder="Judging starts in 10 minutes">
        <button class="primary" id="send">Send</button>
      </div>
      <div>
        <h3>Feed</h3>
        <div id="feed"></div>
      </div>
    </div>
  </div>`);
  const feed = v.querySelector('#feed');
  function redraw(){
    feed.innerHTML = '';
    state.broadcasts.slice().reverse().forEach(m => {
      feed.appendChild(el(`<div class="card"><b>${new Date(m.ts*1000).toLocaleTimeString()}</b><div>${m.message}</div></div>`))
    });
  }
  redraw();
  v.querySelector('#send').onclick = async () => {
    const message = v.querySelector('#msg').value.trim();
    if(!message) return;
    const r = await api('/api/broadcasts', { method:'POST', body: JSON.stringify({ message })});
    state.broadcasts.push(r); redraw();
    v.querySelector('#msg').value='';
  };
  return v;
}

// Router
async function render(viewId='auth'){
  const view = document.getElementById('view');
  view.innerHTML = ''; 
  let v;
  if(viewId==='auth') v = await viewAuth();
  if(viewId==='teams') v = await viewTeams();
  if(viewId==='gigs') v = await viewGigs();
  if(viewId==='mentors') v = await viewMentors();
  if(viewId==='checkin') v = await viewCheckin();
  if(viewId==='leaderboard') v = await viewLeaderboard();
  if(viewId==='judging') v = await viewJudging();
  if(viewId==='space') v = await viewSpace();
  view.appendChild(v);
}

document.addEventListener('DOMContentLoaded', () => {
  setTabs('auth'); render('auth');
  connectWS();
  // hotkeys
  document.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase()==='l') { setTabs('auth'); render('auth'); }
    if(e.key.toLowerCase()==='t') { setTabs('teams'); render('teams'); }
    if(e.key.toLowerCase()==='g') { setTabs('gigs'); render('gigs'); }
  });
});
