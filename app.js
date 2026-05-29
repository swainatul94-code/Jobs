// ========= STORAGE =========
const STORAGE = {
  jobs: 'jt_jobs',
  recruiters: 'jt_recruiters',
  profile: 'jt_profile',
  theme: 'jt_theme'
};

const load = (k, def) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? def; }
  catch { return def; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let jobs = load(STORAGE.jobs, []);
let recruiters = load(STORAGE.recruiters, []);
let profile = load(STORAGE.profile, {
  name: '', email: '', linkedin: '', portfolio: '', years: '', skills: ''
});

// ========= TABS =========
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ========= THEME =========
const themeBtn = document.getElementById('themeToggle');
const applyTheme = (t) => {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
};
applyTheme(load(STORAGE.theme, 'light'));
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
  save(STORAGE.theme, cur);
});

// ========= TOAST =========
const toast = document.getElementById('toast');
let toastTimer;
const showToast = (msg) => {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.hidden = true, 2200);
};

// ========= DASHBOARD =========
const statusList = ['Wishlist', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected'];

function renderDashboard() {
  const counts = Object.fromEntries(statusList.map(s => [s, 0]));
  jobs.forEach(j => { if (counts[j.status] != null) counts[j.status]++; });

  document.getElementById('stat-total').textContent = jobs.length;
  document.getElementById('stat-wishlist').textContent = counts.Wishlist;
  document.getElementById('stat-applied').textContent = counts.Applied;
  document.getElementById('stat-screening').textContent = counts.Screening;
  document.getElementById('stat-interview').textContent = counts.Interview;
  document.getElementById('stat-offer').textContent = counts.Offer;
  document.getElementById('stat-rejected').textContent = counts.Rejected;

  const applied = jobs.length - counts.Wishlist;
  const responded = counts.Screening + counts.Interview + counts.Offer + counts.Rejected;
  const rate = applied ? Math.round((responded / applied) * 100) : 0;
  document.getElementById('stat-response').textContent = rate + '%';

  const pipeline = document.getElementById('pipeline');
  pipeline.innerHTML = statusList.map(s => {
    const items = jobs.filter(j => j.status === s).slice(0, 4);
    return `<div class="pipe-col">
      <h4>${s}</h4>
      <div class="pipe-count">${counts[s]}</div>
      <ul>${items.map(j => `<li>${escapeHtml(j.company)} — ${escapeHtml(j.role)}</li>`).join('')}</ul>
    </div>`;
  }).join('');

  const activity = [...jobs]
    .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0))
    .slice(0, 8);
  document.getElementById('activity').innerHTML = activity.length
    ? activity.map(j => `<li>
        <span><b>${escapeHtml(j.company)}</b> — ${escapeHtml(j.role)} <span class="badge ${slug(j.status)}">${j.status}</span></span>
        <span class="act-date">${j.date || ''}</span>
      </li>`).join('')
    : '<li class="muted">No activity yet.</li>';
}

// ========= JOBS =========
let editingJobId = null;
const jobModal = document.getElementById('jobModal');

document.getElementById('openJobModal').addEventListener('click', () => openJobModal());
document.getElementById('cancelJob').addEventListener('click', () => jobModal.hidden = true);
document.getElementById('saveJob').addEventListener('click', saveJobHandler);

function openJobModal(job = null) {
  editingJobId = job?.id || null;
  document.getElementById('jobModalTitle').textContent = job ? 'Edit Job' : 'Add Job';
  document.getElementById('jCompany').value = job?.company || '';
  document.getElementById('jRole').value = job?.role || '';
  document.getElementById('jLocation').value = job?.location || '';
  document.getElementById('jSalary').value = job?.salary || '';
  document.getElementById('jStatus').value = job?.status || 'Applied';
  document.getElementById('jDate').value = job?.date || new Date().toISOString().slice(0, 10);
  document.getElementById('jLink').value = job?.link || '';
  document.getElementById('jSource').value = job?.source || '';
  document.getElementById('jNotes').value = job?.notes || '';
  document.getElementById('jNextStep').value = job?.nextStep || '';
  jobModal.hidden = false;
}

function saveJobHandler() {
  const company = document.getElementById('jCompany').value.trim();
  const role = document.getElementById('jRole').value.trim();
  if (!company || !role) { showToast('Company and Role required.'); return; }

  const data = {
    company, role,
    location: document.getElementById('jLocation').value.trim(),
    salary: document.getElementById('jSalary').value.trim(),
    status: document.getElementById('jStatus').value,
    date: document.getElementById('jDate').value,
    link: document.getElementById('jLink').value.trim(),
    source: document.getElementById('jSource').value.trim(),
    notes: document.getElementById('jNotes').value.trim(),
    nextStep: document.getElementById('jNextStep').value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (editingJobId) {
    const idx = jobs.findIndex(j => j.id === editingJobId);
    if (idx >= 0) jobs[idx] = { ...jobs[idx], ...data };
  } else {
    jobs.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
  }
  save(STORAGE.jobs, jobs);
  jobModal.hidden = true;
  renderJobs();
  renderDashboard();
  showToast(editingJobId ? 'Job updated.' : 'Job added.');
}

function deleteJob(id) {
  if (!confirm('Delete this job?')) return;
  jobs = jobs.filter(j => j.id !== id);
  save(STORAGE.jobs, jobs);
  renderJobs();
  renderDashboard();
  showToast('Deleted.');
}

function changeJobStatus(id, status) {
  const job = jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    save(STORAGE.jobs, jobs);
    renderJobs();
    renderDashboard();
  }
}

function renderJobs() {
  const search = document.getElementById('jobSearch').value.toLowerCase().trim();
  const status = document.getElementById('filterStatus').value;
  const sortBy = document.getElementById('sortBy').value;

  let list = jobs.filter(j => {
    if (status && j.status !== status) return false;
    if (search) {
      const hay = [j.company, j.role, j.location, j.notes, j.source].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === 'dateAsc') return new Date(a.date || 0) - new Date(b.date || 0);
    if (sortBy === 'company') return (a.company || '').localeCompare(b.company || '');
    if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '');
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  const tbody = document.querySelector('#jobsTable tbody');
  tbody.innerHTML = list.map(j => `
    <tr>
      <td><b>${escapeHtml(j.company)}</b><br><small class="muted">${escapeHtml(j.source || '')}</small></td>
      <td>${escapeHtml(j.role)}</td>
      <td>${escapeHtml(j.location || '')}</td>
      <td>${escapeHtml(j.salary || '')}</td>
      <td>
        <select onchange="changeJobStatus('${j.id}', this.value)" data-current="${j.status}">
          ${statusList.map(s => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>${j.date || ''}</td>
      <td>${j.link ? `<a href="${escapeAttr(j.link)}" target="_blank" rel="noopener">Open</a>` : ''}</td>
      <td class="row-actions">
        <button onclick="editJob('${j.id}')">Edit</button>
        <button onclick="deleteJob('${j.id}')" class="btn-danger">Del</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('jobsEmpty').style.display = list.length ? 'none' : 'block';
  document.getElementById('jobsTable').style.display = list.length ? '' : 'none';
}

window.editJob = (id) => {
  const j = jobs.find(x => x.id === id);
  if (j) openJobModal(j);
};
window.deleteJob = deleteJob;
window.changeJobStatus = changeJobStatus;

document.getElementById('jobSearch').addEventListener('input', renderJobs);
document.getElementById('filterStatus').addEventListener('change', renderJobs);
document.getElementById('sortBy').addEventListener('change', renderJobs);

// ========= RECRUITERS =========
let editingRecId = null;
const recModal = document.getElementById('recModal');

document.getElementById('openRecModal').addEventListener('click', () => openRecModal());
document.getElementById('cancelRec').addEventListener('click', () => recModal.hidden = true);
document.getElementById('saveRec').addEventListener('click', saveRecHandler);

function openRecModal(rec = null) {
  editingRecId = rec?.id || null;
  document.getElementById('recModalTitle').textContent = rec ? 'Edit Recruiter' : 'Add Recruiter';
  document.getElementById('rName').value = rec?.name || '';
  document.getElementById('rCompany').value = rec?.company || '';
  document.getElementById('rEmail').value = rec?.email || '';
  document.getElementById('rLinkedin').value = rec?.linkedin || '';
  document.getElementById('rPhone').value = rec?.phone || '';
  document.getElementById('rStatus').value = rec?.status || 'Not Contacted';
  document.getElementById('rDate').value = rec?.date || '';
  document.getElementById('rNotes').value = rec?.notes || '';
  recModal.hidden = false;
}

function saveRecHandler() {
  const name = document.getElementById('rName').value.trim();
  if (!name) { showToast('Name required.'); return; }
  const data = {
    name,
    company: document.getElementById('rCompany').value.trim(),
    email: document.getElementById('rEmail').value.trim(),
    linkedin: document.getElementById('rLinkedin').value.trim(),
    phone: document.getElementById('rPhone').value.trim(),
    status: document.getElementById('rStatus').value,
    date: document.getElementById('rDate').value,
    notes: document.getElementById('rNotes').value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (editingRecId) {
    const idx = recruiters.findIndex(r => r.id === editingRecId);
    if (idx >= 0) recruiters[idx] = { ...recruiters[idx], ...data };
  } else {
    recruiters.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
  }
  save(STORAGE.recruiters, recruiters);
  recModal.hidden = true;
  renderRecruiters();
  showToast(editingRecId ? 'Recruiter updated.' : 'Recruiter added.');
}

function deleteRec(id) {
  if (!confirm('Delete this recruiter?')) return;
  recruiters = recruiters.filter(r => r.id !== id);
  save(STORAGE.recruiters, recruiters);
  renderRecruiters();
  showToast('Deleted.');
}

function renderRecruiters() {
  const search = document.getElementById('recSearch').value.toLowerCase().trim();
  let list = recruiters.filter(r => {
    if (!search) return true;
    return [r.name, r.company, r.email, r.notes].join(' ').toLowerCase().includes(search);
  });
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const tbody = document.querySelector('#recTable tbody');
  tbody.innerHTML = list.map(r => `
    <tr>
      <td><b>${escapeHtml(r.name)}</b>${r.phone ? `<br><small class="muted">${escapeHtml(r.phone)}</small>` : ''}</td>
      <td>${escapeHtml(r.company || '')}</td>
      <td>${r.email ? `<a href="mailto:${escapeAttr(r.email)}">${escapeHtml(r.email)}</a>` : ''}</td>
      <td>${r.linkedin ? `<a href="${escapeAttr(r.linkedin)}" target="_blank" rel="noopener">Profile</a>` : ''}</td>
      <td>${r.date || ''}</td>
      <td><span class="badge ${slug(r.status)}">${r.status}</span></td>
      <td class="row-actions">
        <button onclick="emailRecruiter('${r.id}')">Email</button>
        <button onclick="editRec('${r.id}')">Edit</button>
        <button onclick="deleteRec('${r.id}')" class="btn-danger">Del</button>
      </td>
    </tr>
  `).join('');
  document.getElementById('recEmpty').style.display = list.length ? 'none' : 'block';
  document.getElementById('recTable').style.display = list.length ? '' : 'none';
}

window.editRec = (id) => {
  const r = recruiters.find(x => x.id === id);
  if (r) openRecModal(r);
};
window.deleteRec = deleteRec;
window.emailRecruiter = (id) => {
  const r = recruiters.find(x => x.id === id);
  if (!r) return;
  document.querySelector('[data-tab="email"]').click();
  document.getElementById('emRecName').value = r.name;
  document.getElementById('emCompany').value = r.company || '';
  generateEmailContent();
};

document.getElementById('recSearch').addEventListener('input', renderRecruiters);

// ========= EMAIL TEMPLATES =========
const templates = {
  referral: (d) => ({
    subject: `Referral request — ${d.role} role at ${d.company}`,
    body:
`Hi ${d.recName || '[Name]'},

I hope you are doing well. I came across the ${d.role || '[Role]'} opening at ${d.company || '[Company]'} and felt my background lines up closely with what the team is looking for.

I have ${d.years || '[X]'} years of experience working with ${d.skills || '[key skills]'}, and I would love the chance to contribute at ${d.company || '[Company]'}. If you are open to it, would you be willing to refer me or point me to the right person on the team?

I have attached my resume below for context, and you can also see more of my work here: ${d.link || '[link]'}

Thanks so much for your time — happy to share more details if helpful.

Best regards,
${d.yourName || '[Your Name]'}`
  }),
  recruiter: (d) => ({
    subject: `${d.role || '[Role]'} — ${d.years || 'X'} yrs experience, interested in ${d.company || '[Company]'}`,
    body:
`Hi ${d.recName || '[Name]'},

I am reaching out because I am very interested in opportunities at ${d.company || '[Company]'} — particularly the ${d.role || '[Role]'} position.

A quick snapshot:
• ${d.years || '[X]'} years of experience in ${d.skills || '[key skills]'}
• Looking for roles where I can ${d.role ? `grow as a ${d.role}` : 'take on bigger ownership'}
• Profile: ${d.link || '[LinkedIn/Portfolio]'}

Would you have 15 minutes this week or next to discuss whether there is a fit? Happy to share my resume and answer any questions.

Thanks for your time,
${d.yourName || '[Your Name]'}`
  }),
  followup: (d) => ({
    subject: `Following up — ${d.role || '[Role]'} application`,
    body:
`Hi ${d.recName || 'Hiring Team'},

I wanted to follow up on my application for the ${d.role || '[Role]'} role at ${d.company || '[Company]'}, submitted recently. I remain very interested in the opportunity and would love to learn about the next steps.

To recap quickly: I bring ${d.years || '[X]'} years of experience in ${d.skills || '[key skills]'}, and I believe I can add real value to the team.

I have linked my resume / profile here for convenience: ${d.link || '[link]'}

Please let me know if there is any additional information I can share. Looking forward to hearing back.

Best regards,
${d.yourName || '[Your Name]'}`
  }),
  postinterview: (d) => ({
    subject: `Thank you — ${d.role || '[Role]'} interview`,
    body:
`Hi ${d.recName || '[Name]'},

Thank you for taking the time to speak with me about the ${d.role || '[Role]'} position at ${d.company || '[Company]'}. I really enjoyed the conversation and learning more about the team and the problems you are solving.

The discussion reinforced my interest in the role — particularly the chance to work on the challenges we discussed. With my background in ${d.skills || '[key skills]'} and ${d.years || '[X]'} years of experience, I feel I could contribute meaningfully from day one.

Please let me know if there is anything more I can share. Looking forward to the next steps.

Best regards,
${d.yourName || '[Your Name]'}`
  }),
  networking: (d) => ({
    subject: `Quick chat — ${d.company || '[Company]'} / ${d.role || '[Role]'}`,
    body:
`Hi ${d.recName || '[Name]'},

I came across your profile and was impressed by your work at ${d.company || '[Company]'}. I am currently exploring ${d.role || '[Role]'} opportunities and would love to learn from your experience.

A bit about me: ${d.years || '[X]'} years working with ${d.skills || '[key skills]'}. More here: ${d.link || '[link]'}

Would you be open to a brief 15-20 minute virtual coffee chat in the next couple of weeks? I would really appreciate any insights about the team, culture, or hiring at ${d.company || '[Company]'}.

Thanks so much,
${d.yourName || '[Your Name]'}`
  })
};

function generateEmailContent() {
  const d = {
    recName: document.getElementById('emRecName').value.trim(),
    company: document.getElementById('emCompany').value.trim(),
    role: document.getElementById('emRole').value.trim(),
    yourName: document.getElementById('emYourName').value.trim() || profile.name,
    years: document.getElementById('emYears').value.trim() || profile.years,
    skills: document.getElementById('emSkills').value.trim() || profile.skills,
    link: document.getElementById('emLink').value.trim() || profile.linkedin || profile.portfolio
  };
  const tpl = templates[document.getElementById('emailTemplate').value](d);
  document.getElementById('emSubject').value = tpl.subject;
  document.getElementById('emBody').value = tpl.body;
}

document.getElementById('generateEmail').addEventListener('click', generateEmailContent);

const copy = async (text, label) => {
  try { await navigator.clipboard.writeText(text); showToast(label + ' copied.'); }
  catch { showToast('Copy failed.'); }
};
document.getElementById('copySubject').addEventListener('click', () => copy(document.getElementById('emSubject').value, 'Subject'));
document.getElementById('copyBody').addEventListener('click', () => copy(document.getElementById('emBody').value, 'Body'));
document.getElementById('copyAll').addEventListener('click', () => {
  const s = document.getElementById('emSubject').value;
  const b = document.getElementById('emBody').value;
  copy(`Subject: ${s}\n\n${b}`, 'Email');
});
document.getElementById('openMail').addEventListener('click', () => {
  const s = encodeURIComponent(document.getElementById('emSubject').value);
  const b = encodeURIComponent(document.getElementById('emBody').value);
  window.location.href = `mailto:?subject=${s}&body=${b}`;
});

// ========= PROFILE =========
function loadProfileForm() {
  document.getElementById('profName').value = profile.name || '';
  document.getElementById('profEmail').value = profile.email || '';
  document.getElementById('profLinkedin').value = profile.linkedin || '';
  document.getElementById('profPortfolio').value = profile.portfolio || '';
  document.getElementById('profYears').value = profile.years || '';
  document.getElementById('profSkills').value = profile.skills || '';

  document.getElementById('emYourName').value = profile.name || '';
  document.getElementById('emYears').value = profile.years || '';
  document.getElementById('emSkills').value = profile.skills || '';
  document.getElementById('emLink').value = profile.linkedin || profile.portfolio || '';
}

document.getElementById('saveProfile').addEventListener('click', () => {
  profile = {
    name: document.getElementById('profName').value.trim(),
    email: document.getElementById('profEmail').value.trim(),
    linkedin: document.getElementById('profLinkedin').value.trim(),
    portfolio: document.getElementById('profPortfolio').value.trim(),
    years: document.getElementById('profYears').value.trim(),
    skills: document.getElementById('profSkills').value.trim()
  };
  save(STORAGE.profile, profile);
  loadProfileForm();
  showToast('Profile saved.');
});

// ========= BACKUP =========
document.getElementById('exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ jobs, recruiters, profile, exportedAt: new Date().toISOString() }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported.');
});

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.jobs) jobs = data.jobs;
    if (data.recruiters) recruiters = data.recruiters;
    if (data.profile) profile = data.profile;
    save(STORAGE.jobs, jobs);
    save(STORAGE.recruiters, recruiters);
    save(STORAGE.profile, profile);
    loadProfileForm();
    renderJobs();
    renderRecruiters();
    renderDashboard();
    showToast('Imported.');
  } catch (err) {
    showToast('Invalid file.');
  }
  e.target.value = '';
});

document.getElementById('clearData').addEventListener('click', () => {
  if (!confirm('This will delete ALL jobs, recruiters, and profile data. Continue?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  jobs = []; recruiters = []; profile = { name: '', email: '', linkedin: '', portfolio: '', years: '', skills: '' };
  save(STORAGE.jobs, jobs);
  save(STORAGE.recruiters, recruiters);
  save(STORAGE.profile, profile);
  loadProfileForm();
  renderJobs();
  renderRecruiters();
  renderDashboard();
  showToast('All data cleared.');
});

// ========= UTIL =========
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function slug(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-'); }

// ========= INIT =========
loadProfileForm();
renderJobs();
renderRecruiters();
renderDashboard();
generateEmailContent();
