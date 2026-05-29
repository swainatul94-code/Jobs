// ========= STORAGE =========
const STORAGE = {
  jobs: 'jt_jobs',
  recruiters: 'jt_recruiters',
  profile: 'jt_profile',
  theme: 'jt_theme'
};

const load = (k, def) => {
  try {
    const raw = localStorage.getItem(k);
    if (raw == null) return def;
    const parsed = JSON.parse(raw);
    return parsed == null ? def : parsed;
  } catch { return def; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) {
    console.error('Storage write failed', err);
    showToast(err && err.name === 'QuotaExceededError'
      ? 'Storage full. Export and clear old data.'
      : 'Could not save. Check browser storage settings.');
    return false;
  }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_PROFILE = { name: '', email: '', linkedin: '', portfolio: '', years: '', skills: '' };

let jobs = sanitizeJobList(load(STORAGE.jobs, []));
let recruiters = sanitizeRecruiterList(load(STORAGE.recruiters, []));
let profile = sanitizeProfile(load(STORAGE.profile, DEFAULT_PROFILE));

// ========= VALIDATION =========
const JOB_STATUSES = ['Wishlist', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected'];
const REC_STATUSES = ['Not Contacted', 'Reached Out', 'Responded', 'In Discussion', 'Closed'];

function sanitizeJobList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(j => j && typeof j === 'object').map(j => ({
    id: typeof j.id === 'string' ? j.id : uid(),
    company: str(j.company),
    role: str(j.role),
    location: str(j.location),
    salary: str(j.salary),
    status: JOB_STATUSES.includes(j.status) ? j.status : 'Applied',
    date: str(j.date).slice(0, 10),
    link: safeUrl(j.link),
    source: str(j.source),
    notes: str(j.notes),
    nextStep: str(j.nextStep),
    createdAt: str(j.createdAt) || new Date().toISOString(),
    updatedAt: str(j.updatedAt) || new Date().toISOString()
  }));
}

function sanitizeRecruiterList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(r => r && typeof r === 'object').map(r => ({
    id: typeof r.id === 'string' ? r.id : uid(),
    name: str(r.name),
    company: str(r.company),
    email: str(r.email),
    linkedin: safeUrl(r.linkedin),
    phone: str(r.phone),
    status: REC_STATUSES.includes(r.status) ? r.status : 'Not Contacted',
    date: str(r.date).slice(0, 10),
    notes: str(r.notes),
    createdAt: str(r.createdAt) || new Date().toISOString(),
    updatedAt: str(r.updatedAt) || new Date().toISOString()
  }));
}

function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') return { ...DEFAULT_PROFILE };
  return {
    name: str(p.name), email: str(p.email),
    linkedin: safeUrl(p.linkedin), portfolio: safeUrl(p.portfolio),
    years: str(p.years), skills: str(p.skills)
  };
}

const str = v => (typeof v === 'string' ? v : '').slice(0, 2000);

function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const trimmed = u.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2000) return '';
  if (/^(https?|mailto):/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return '';
  return 'https://' + trimmed;
}

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
  const theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  themeBtn.textContent = theme === 'dark' ? '☀' : '☽';
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
function showToast(msg) {
  toast.textContent = String(msg).slice(0, 200);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ========= DATE =========
function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// ========= DASHBOARD =========
function renderDashboard() {
  const counts = Object.fromEntries(JOB_STATUSES.map(s => [s, 0]));
  jobs.forEach(j => { if (counts[j.status] != null) counts[j.status]++; });

  setText('stat-total', jobs.length);
  setText('stat-wishlist', counts.Wishlist);
  setText('stat-applied', counts.Applied);
  setText('stat-screening', counts.Screening);
  setText('stat-interview', counts.Interview);
  setText('stat-offer', counts.Offer);
  setText('stat-rejected', counts.Rejected);

  const applied = jobs.length - counts.Wishlist;
  const responded = counts.Screening + counts.Interview + counts.Offer + counts.Rejected;
  const rate = applied ? Math.round((responded / applied) * 100) : 0;
  setText('stat-response', rate + '%');

  const pipeline = document.getElementById('pipeline');
  pipeline.replaceChildren();
  JOB_STATUSES.forEach(s => {
    const items = jobs.filter(j => j.status === s).slice(0, 4);
    const col = el('div', { class: 'pipe-col' }, [
      el('h4', {}, s),
      el('div', { class: 'pipe-count' }, String(counts[s])),
      el('ul', {}, items.map(j => el('li', {}, `${j.company} — ${j.role}`)))
    ]);
    pipeline.appendChild(col);
  });

  const activity = [...jobs]
    .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0))
    .slice(0, 8);
  const actList = document.getElementById('activity');
  actList.replaceChildren();
  if (!activity.length) {
    actList.appendChild(el('li', { class: 'muted' }, 'No activity yet.'));
  } else {
    activity.forEach(j => {
      const left = el('span', {}, [
        el('b', {}, j.company), ' — ', j.role, ' ',
        el('span', { class: 'badge ' + slug(j.status) }, j.status)
      ]);
      const right = el('span', { class: 'act-date' }, j.date || '');
      actList.appendChild(el('li', {}, [left, right]));
    });
  }
}

// ========= DOM HELPERS =========
function el(tag, attrs = {}, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}
function appendChildren(node, children) {
  if (children == null) return;
  if (Array.isArray(children)) children.forEach(c => appendChildren(node, c));
  else if (children instanceof Node) node.appendChild(children);
  else node.appendChild(document.createTextNode(String(children)));
}
function setText(id, v) {
  const n = document.getElementById(id);
  if (n) n.textContent = String(v);
}
function slug(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-'); }

// ========= JOBS =========
let editingJobId = null;
const jobModal = document.getElementById('jobModal');

document.getElementById('openJobModal').addEventListener('click', () => openJobModal());
document.getElementById('cancelJob').addEventListener('click', () => closeModal(jobModal));
document.getElementById('saveJob').addEventListener('click', saveJobHandler);

function openJobModal(job = null) {
  editingJobId = job?.id || null;
  document.getElementById('jobModalTitle').textContent = job ? 'Edit Job' : 'Add Job';
  setVal('jCompany', job?.company || '');
  setVal('jRole', job?.role || '');
  setVal('jLocation', job?.location || '');
  setVal('jSalary', job?.salary || '');
  setVal('jStatus', job?.status || 'Applied');
  setVal('jDate', job?.date || todayLocal());
  setVal('jLink', job?.link || '');
  setVal('jSource', job?.source || '');
  setVal('jNotes', job?.notes || '');
  setVal('jNextStep', job?.nextStep || '');
  jobModal.hidden = false;
}

function saveJobHandler() {
  const company = getVal('jCompany').trim();
  const role = getVal('jRole').trim();
  if (!company || !role) { showToast('Company and Role required.'); return; }

  const data = {
    company, role,
    location: getVal('jLocation').trim(),
    salary: getVal('jSalary').trim(),
    status: JOB_STATUSES.includes(getVal('jStatus')) ? getVal('jStatus') : 'Applied',
    date: getVal('jDate'),
    link: safeUrl(getVal('jLink')),
    source: getVal('jSource').trim(),
    notes: getVal('jNotes').trim(),
    nextStep: getVal('jNextStep').trim(),
    updatedAt: new Date().toISOString()
  };

  if (editingJobId) {
    const idx = jobs.findIndex(j => j.id === editingJobId);
    if (idx >= 0) jobs[idx] = { ...jobs[idx], ...data };
  } else {
    jobs.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
  }
  save(STORAGE.jobs, jobs);
  closeModal(jobModal);
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
  if (!JOB_STATUSES.includes(status)) return;
  const job = jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    save(STORAGE.jobs, jobs);
    renderDashboard();
  }
}

function renderJobs() {
  const search = getVal('jobSearch').toLowerCase().trim();
  const status = getVal('filterStatus');
  const sortBy = getVal('sortBy');

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
  tbody.replaceChildren();
  list.forEach(j => {
    const statusSel = el('select', { dataset: { action: 'job-status', id: j.id } },
      JOB_STATUSES.map(s => {
        const opt = el('option', {}, s);
        if (s === j.status) opt.selected = true;
        return opt;
      })
    );
    const linkCell = el('td', {});
    if (j.link) {
      linkCell.appendChild(el('a', { href: j.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open'));
    }
    const companyCell = el('td', {}, [
      el('b', {}, j.company),
      j.source ? el('br') : null,
      j.source ? el('small', { class: 'muted' }, j.source) : null
    ]);
    const actions = el('td', { class: 'row-actions' }, [
      el('button', { dataset: { action: 'edit-job', id: j.id } }, 'Edit'),
      el('button', { class: 'btn-danger', dataset: { action: 'delete-job', id: j.id } }, 'Del')
    ]);
    tbody.appendChild(el('tr', {}, [
      companyCell,
      el('td', {}, j.role),
      el('td', {}, j.location || ''),
      el('td', {}, j.salary || ''),
      el('td', {}, statusSel),
      el('td', {}, j.date || ''),
      linkCell,
      actions
    ]));
  });

  document.getElementById('jobsEmpty').style.display = list.length ? 'none' : 'block';
  document.getElementById('jobsTable').style.display = list.length ? '' : 'none';
}

document.getElementById('jobsTable').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-job') {
    const j = jobs.find(x => x.id === id);
    if (j) openJobModal(j);
  } else if (btn.dataset.action === 'delete-job') {
    deleteJob(id);
  }
});
document.getElementById('jobsTable').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-action="job-status"]');
  if (!sel) return;
  changeJobStatus(sel.dataset.id, sel.value);
});

document.getElementById('jobSearch').addEventListener('input', renderJobs);
document.getElementById('filterStatus').addEventListener('change', renderJobs);
document.getElementById('sortBy').addEventListener('change', renderJobs);

// ========= RECRUITERS =========
let editingRecId = null;
const recModal = document.getElementById('recModal');

document.getElementById('openRecModal').addEventListener('click', () => openRecModal());
document.getElementById('cancelRec').addEventListener('click', () => closeModal(recModal));
document.getElementById('saveRec').addEventListener('click', saveRecHandler);

function openRecModal(rec = null) {
  editingRecId = rec?.id || null;
  document.getElementById('recModalTitle').textContent = rec ? 'Edit Recruiter' : 'Add Recruiter';
  setVal('rName', rec?.name || '');
  setVal('rCompany', rec?.company || '');
  setVal('rEmail', rec?.email || '');
  setVal('rLinkedin', rec?.linkedin || '');
  setVal('rPhone', rec?.phone || '');
  setVal('rStatus', rec?.status || 'Not Contacted');
  setVal('rDate', rec?.date || '');
  setVal('rNotes', rec?.notes || '');
  recModal.hidden = false;
}

function saveRecHandler() {
  const name = getVal('rName').trim();
  if (!name) { showToast('Name required.'); return; }
  const email = getVal('rEmail').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Invalid email.'); return;
  }
  const data = {
    name,
    company: getVal('rCompany').trim(),
    email,
    linkedin: safeUrl(getVal('rLinkedin')),
    phone: getVal('rPhone').trim(),
    status: REC_STATUSES.includes(getVal('rStatus')) ? getVal('rStatus') : 'Not Contacted',
    date: getVal('rDate'),
    notes: getVal('rNotes').trim(),
    updatedAt: new Date().toISOString()
  };
  if (editingRecId) {
    const idx = recruiters.findIndex(r => r.id === editingRecId);
    if (idx >= 0) recruiters[idx] = { ...recruiters[idx], ...data };
  } else {
    recruiters.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
  }
  save(STORAGE.recruiters, recruiters);
  closeModal(recModal);
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
  const search = getVal('recSearch').toLowerCase().trim();
  let list = recruiters.filter(r => {
    if (!search) return true;
    return [r.name, r.company, r.email, r.notes].join(' ').toLowerCase().includes(search);
  });
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const tbody = document.querySelector('#recTable tbody');
  tbody.replaceChildren();
  list.forEach(r => {
    const emailCell = el('td', {});
    if (r.email) emailCell.appendChild(el('a', { href: 'mailto:' + r.email }, r.email));
    const liCell = el('td', {});
    if (r.linkedin) liCell.appendChild(el('a', { href: r.linkedin, target: '_blank', rel: 'noopener noreferrer' }, 'Profile'));
    const nameCell = el('td', {}, [
      el('b', {}, r.name),
      r.phone ? el('br') : null,
      r.phone ? el('small', { class: 'muted' }, r.phone) : null
    ]);
    const actions = el('td', { class: 'row-actions' }, [
      el('button', { dataset: { action: 'email-rec', id: r.id } }, 'Email'),
      el('button', { dataset: { action: 'edit-rec', id: r.id } }, 'Edit'),
      el('button', { class: 'btn-danger', dataset: { action: 'delete-rec', id: r.id } }, 'Del')
    ]);
    tbody.appendChild(el('tr', {}, [
      nameCell,
      el('td', {}, r.company || ''),
      emailCell,
      liCell,
      el('td', {}, r.date || ''),
      el('td', {}, el('span', { class: 'badge ' + slug(r.status) }, r.status)),
      actions
    ]));
  });
  document.getElementById('recEmpty').style.display = list.length ? 'none' : 'block';
  document.getElementById('recTable').style.display = list.length ? '' : 'none';
}

document.getElementById('recTable').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-rec') {
    const r = recruiters.find(x => x.id === id);
    if (r) openRecModal(r);
  } else if (btn.dataset.action === 'delete-rec') {
    deleteRec(id);
  } else if (btn.dataset.action === 'email-rec') {
    const r = recruiters.find(x => x.id === id);
    if (!r) return;
    document.querySelector('[data-tab="email"]').click();
    setVal('emRecName', r.name);
    setVal('emCompany', r.company || '');
    generateEmailContent();
  }
});

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
  const tplKey = getVal('emailTemplate');
  if (!templates[tplKey]) return;
  const d = {
    recName: getVal('emRecName').trim(),
    company: getVal('emCompany').trim(),
    role: getVal('emRole').trim(),
    yourName: getVal('emYourName').trim() || profile.name,
    years: getVal('emYears').trim() || profile.years,
    skills: getVal('emSkills').trim() || profile.skills,
    link: getVal('emLink').trim() || profile.linkedin || profile.portfolio
  };
  const tpl = templates[tplKey](d);
  setVal('emSubject', tpl.subject);
  setVal('emBody', tpl.body);
}

document.getElementById('generateEmail').addEventListener('click', generateEmailContent);

const copy = async (text, label) => {
  try { await navigator.clipboard.writeText(text); showToast(label + ' copied.'); }
  catch { showToast('Copy failed. Select and copy manually.'); }
};
document.getElementById('copySubject').addEventListener('click', () => copy(getVal('emSubject'), 'Subject'));
document.getElementById('copyBody').addEventListener('click', () => copy(getVal('emBody'), 'Body'));
document.getElementById('copyAll').addEventListener('click', () => {
  copy(`Subject: ${getVal('emSubject')}\n\n${getVal('emBody')}`, 'Email');
});
document.getElementById('openMail').addEventListener('click', () => {
  const s = encodeURIComponent(getVal('emSubject'));
  const b = encodeURIComponent(getVal('emBody'));
  const a = document.createElement('a');
  a.href = `mailto:?subject=${s}&body=${b}`;
  a.click();
});

// ========= PROFILE =========
function loadProfileForm() {
  setVal('profName', profile.name);
  setVal('profEmail', profile.email);
  setVal('profLinkedin', profile.linkedin);
  setVal('profPortfolio', profile.portfolio);
  setVal('profYears', profile.years);
  setVal('profSkills', profile.skills);

  setVal('emYourName', profile.name);
  setVal('emYears', profile.years);
  setVal('emSkills', profile.skills);
  setVal('emLink', profile.linkedin || profile.portfolio);
}

document.getElementById('saveProfile').addEventListener('click', () => {
  profile = sanitizeProfile({
    name: getVal('profName').trim(),
    email: getVal('profEmail').trim(),
    linkedin: getVal('profLinkedin').trim(),
    portfolio: getVal('profPortfolio').trim(),
    years: getVal('profYears').trim(),
    skills: getVal('profSkills').trim()
  });
  save(STORAGE.profile, profile);
  loadProfileForm();
  showToast('Profile saved.');
});

// ========= BACKUP =========
document.getElementById('exportData').addEventListener('click', () => {
  try {
    const blob = new Blob(
      [JSON.stringify({ version: 1, jobs, recruiters, profile, exportedAt: new Date().toISOString() }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-tracker-${todayLocal()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Exported.');
  } catch {
    showToast('Export failed.');
  }
});

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB).'); e.target.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('bad shape');
    if (!confirm('Import will REPLACE all current data. Continue?')) { e.target.value = ''; return; }
    if (Array.isArray(data.jobs)) jobs = sanitizeJobList(data.jobs);
    if (Array.isArray(data.recruiters)) recruiters = sanitizeRecruiterList(data.recruiters);
    if (data.profile && typeof data.profile === 'object') profile = sanitizeProfile(data.profile);
    save(STORAGE.jobs, jobs);
    save(STORAGE.recruiters, recruiters);
    save(STORAGE.profile, profile);
    loadProfileForm();
    renderJobs();
    renderRecruiters();
    renderDashboard();
    showToast('Imported.');
  } catch {
    showToast('Invalid file.');
  }
  e.target.value = '';
});

document.getElementById('clearData').addEventListener('click', () => {
  if (!confirm('This will delete ALL jobs, recruiters, and profile data. Continue?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  jobs = [];
  recruiters = [];
  profile = { ...DEFAULT_PROFILE };
  save(STORAGE.jobs, jobs);
  save(STORAGE.recruiters, recruiters);
  save(STORAGE.profile, profile);
  loadProfileForm();
  renderJobs();
  renderRecruiters();
  renderDashboard();
  showToast('All data cleared.');
});

// ========= MODAL CLOSE =========
function closeModal(m) { m.hidden = true; }
[jobModal, recModal].forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!jobModal.hidden) closeModal(jobModal);
    if (!recModal.hidden) closeModal(recModal);
  }
});

// ========= INPUT HELPERS =========
function getVal(id) {
  const n = document.getElementById(id);
  return n ? n.value : '';
}
function setVal(id, v) {
  const n = document.getElementById(id);
  if (n) n.value = v == null ? '' : v;
}

// ========= INIT =========
loadProfileForm();
renderJobs();
renderRecruiters();
renderDashboard();
generateEmailContent();
