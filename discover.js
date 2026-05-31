// ========= DISCOVER / LIVE JOB SEARCH =========
// Fetches openings from public, CORS-friendly job-board APIs (no scraping, no keys).
// Relies on globals defined in app.js: el, slug, showToast, todayLocal, jobs,
// save, STORAGE, uid, safeUrl, renderJobs, renderDashboard.
(function () {
  'use strict';

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const dQuery = $('dQuery');
  const dLocation = $('dLocation');
  const dCompanySlug = $('dCompanySlug');
  const dSearchBtn = $('dSearch');
  const dStatus = $('dStatus');
  const dResults = $('dResults');
  if (!dSearchBtn) return; // discover tab not present

  const SOURCE_LABEL = {
    remotive: 'Remotive',
    remoteok: 'RemoteOK',
    arbeitnow: 'Arbeitnow',
    jobicy: 'Jobicy',
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    adzuna: 'Adzuna',
    jooble: 'Jooble'
  };

  // ---- AI refs + state (backend at /api/ai/*) ----
  const dRankBtn = $('dRank');
  const dFeedBtn = $('dFeed');
  const aiHint = $('aiHint');
  const aiEmailBtn = $('aiEmail');
  const AI = { available: false, model: '' };
  let lastResults = [];

  const ACCESS_KEY = 'jt_access';
  function getToken() { try { return localStorage.getItem(ACCESS_KEY) || ''; } catch { return ''; } }
  function setToken(v) { try { localStorage.setItem(ACCESS_KEY, v); } catch { /* ignore */ } }

  // fetch wrapper that attaches the access password and, on a 401 'unauthorized',
  // prompts for it once and retries. Shared with resume.js via window.JT_aiFetch.
  async function aiFetch(url, options) {
    options = options || {};
    const run = () => {
      const headers = Object.assign({}, options.headers);
      const tok = getToken();
      if (tok) headers['x-access-password'] = tok;
      return fetch(url, Object.assign({}, options, { headers }));
    };
    let res = await run();
    if (res.status === 401) {
      const data = await res.clone().json().catch(() => ({}));
      if (data && data.error === 'unauthorized') {
        const pw = window.prompt('This server is password-protected. Enter the access password:');
        if (pw) { setToken(pw); res = await run(); }
      }
    }
    return res;
  }
  window.JT_aiFetch = aiFetch;

  async function postJSON(url, body) {
    const res = await aiFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function aiProfile() {
    const p = (typeof profile === 'object' && profile) ? profile : {};
    return { name: p.name, years: p.years, skills: p.skills };
  }

  async function checkAI() {
    let d = null;
    try {
      d = await (await fetch('/api/ai/health')).json();
      AI.available = !!(d && d.ai);
      AI.model = (d && d.model) || '';
    } catch { AI.available = false; }
    // Reveal keyed sources only when the backend has their keys.
    const revealSource = (toggleId, on) => {
      const t = document.getElementById(toggleId);
      if (!t) return;
      t.hidden = !on;
      const cb = t.querySelector('input');
      if (cb) cb.checked = on;
    };
    revealSource('adzunaToggle', !!(d && d.sources && d.sources.adzuna));
    revealSource('joobleToggle', !!(d && d.sources && d.sources.jooble));
    if (dRankBtn) dRankBtn.hidden = !AI.available;
    if (aiEmailBtn) aiEmailBtn.hidden = !AI.available;
    if (aiHint) {
      aiHint.textContent = AI.available
        ? 'AI ready · ' + AI.model
        : 'AI off — run the backend with an ANTHROPIC_API_KEY to enable ranking, tailoring & insight.';
    }
  }

  // ---- helpers ----
  async function fetchJSON(url, timeout = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Decode HTML to plain text without ever executing/injecting it.
  function stripHtml(html) {
    if (!html) return '';
    const s = String(html);
    try {
      const doc = new DOMParser().parseFromString(s, 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch {
      return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  function fmtDate(d) {
    if (d == null || d === '') return '';
    let date;
    if (typeof d === 'number') date = new Date(d > 1e12 ? d : d * 1000);
    else date = new Date(d);
    if (isNaN(date.getTime())) return typeof d === 'string' ? d.slice(0, 10) : '';
    return date.toISOString().slice(0, 10);
  }

  function money(min, max, cur) {
    const c = cur ? String(cur).trim() + ' ' : '';
    const f = (n) => (typeof n === 'number' ? n.toLocaleString() : String(n));
    if (min && max && min !== max) return c + f(min) + ' – ' + c + f(max);
    if (min || max) return c + f(min || max);
    return '';
  }

  function asArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v == null || v === '') return [];
    return [String(v)];
  }

  // ---- source adapters: each returns a normalized job array ----
  // normalized job: { source, title, company, location, salary, tags[], url, date, desc }
  const ADAPTERS = {
    async remotive(q) {
      const url = 'https://remotive.com/api/remote-jobs?limit=100' +
        (q ? '&search=' + encodeURIComponent(q) : '');
      const data = await fetchJSON(url);
      return (data && Array.isArray(data.jobs) ? data.jobs : []).map((j) => ({
        source: 'Remotive',
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || 'Remote',
        salary: j.salary || '',
        tags: asArray(j.tags),
        url: j.url,
        date: j.publication_date,
        desc: stripHtml(j.description)
      }));
    },

    async remoteok() {
      const data = await fetchJSON('https://remoteok.com/api');
      const arr = Array.isArray(data) ? data : [];
      return arr.filter((j) => j && j.position && j.url).map((j) => ({
        source: 'RemoteOK',
        title: j.position,
        company: j.company,
        location: j.location || 'Remote',
        salary: money(j.salary_min, j.salary_max, '$'),
        tags: asArray(j.tags),
        url: j.url,
        date: j.date,
        desc: stripHtml(j.description)
      }));
    },

    async arbeitnow() {
      const data = await fetchJSON('https://www.arbeitnow.com/api/job-board-api');
      return (data && Array.isArray(data.data) ? data.data : []).map((j) => ({
        source: 'Arbeitnow',
        title: j.title,
        company: j.company_name,
        location: j.location || (j.remote ? 'Remote' : ''),
        salary: '',
        tags: asArray(j.tags).concat(asArray(j.job_types)),
        url: j.url,
        date: j.created_at,
        desc: stripHtml(j.description)
      }));
    },

    async jobicy() {
      // Jobicy's ?tag= only accepts its own controlled vocabulary and 400s on
      // free text, so fetch broadly and let the shared client filter narrow it.
      const data = await fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=100');
      return (data && Array.isArray(data.jobs) ? data.jobs : []).map((j) => ({
        source: 'Jobicy',
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || 'Remote',
        salary: money(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency),
        tags: asArray(j.jobIndustry).concat(asArray(j.jobType)),
        url: j.url,
        date: j.pubDate,
        desc: stripHtml(j.jobExcerpt || j.jobDescription)
      }));
    },

    async greenhouse(companySlug) {
      const s = encodeURIComponent(String(companySlug).trim());
      const data = await fetchJSON('https://boards-api.greenhouse.io/v1/boards/' + s + '/jobs?content=true');
      return (data && Array.isArray(data.jobs) ? data.jobs : []).map((j) => ({
        source: 'Greenhouse',
        title: j.title,
        company: companySlug,
        location: (j.location && j.location.name) || '',
        salary: '',
        tags: [],
        url: j.absolute_url,
        date: j.updated_at,
        desc: stripHtml(j.content)
      }));
    },

    // Adzuna goes through our backend proxy (key stays server-side). Covers AU.
    async adzuna(q, loc) {
      const params = new URLSearchParams({ country: 'au', what: q || '', where: loc || '' });
      const res = await aiFetch('/api/jobs/adzuna?' + params.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return (data.jobs || []).map((j) => ({
        source: 'Adzuna',
        title: j.title,
        company: j.company,
        location: j.location,
        salary: j.salary || '',
        tags: asArray(j.tags),
        url: j.url,
        date: j.date,
        desc: stripHtml(j.desc)
      }));
    },

    // Jooble via backend proxy (key server-side). Broad coverage incl. AU/India.
    async jooble(q, loc) {
      const params = new URLSearchParams({ what: q || '', where: loc || '' });
      const res = await aiFetch('/api/jobs/jooble?' + params.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return (data.jobs || []).map((j) => ({
        source: 'Jooble',
        title: j.title,
        company: j.company,
        location: j.location,
        salary: j.salary || '',
        tags: asArray(j.tags),
        url: j.url,
        date: j.date,
        desc: stripHtml(j.desc)
      }));
    },

    async lever(companySlug) {
      const s = encodeURIComponent(String(companySlug).trim());
      const data = await fetchJSON('https://api.lever.co/v0/postings/' + s + '?mode=json');
      const arr = Array.isArray(data) ? data : [];
      return arr.map((j) => ({
        source: 'Lever',
        title: j.text,
        company: companySlug,
        location: (j.categories && j.categories.location) || '',
        salary: '',
        tags: [j.categories && j.categories.team, j.categories && j.categories.commitment].filter(Boolean),
        url: j.hostedUrl,
        date: j.createdAt,
        desc: j.descriptionPlain || stripHtml(j.description)
      }));
    }
  };

  // ---- filtering / dedupe ----
  function matches(j, terms, loc) {
    if (terms.length) {
      const hay = [j.title, j.company, j.location, (j.tags || []).join(' '), j.desc]
        .join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (loc) {
      const full = [j.location, j.title, j.desc].join(' ').toLowerCase();
      if (!full.includes(loc)) return false;
    }
    return true;
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const j of list) {
      const key = (j.url || (j.source + '|' + j.title + '|' + j.company)).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(j);
    }
    return out;
  }

  function savedUrls() {
    const set = new Set();
    jobs.forEach((j) => { if (j.link) set.add(j.link.toLowerCase()); });
    return set;
  }

  // ---- save / apply a result into the tracker ----
  function buildJob(r, status) {
    const now = new Date().toISOString();
    return {
      id: uid(),
      company: String(r.company || '').slice(0, 2000),
      role: String(r.title || '').slice(0, 2000),
      location: String(r.location || '').slice(0, 2000),
      salary: String(r.salary || '').slice(0, 2000),
      status,
      date: todayLocal(),
      link: safeUrl(r.url || ''),
      source: r.source || '',
      notes: r.desc ? truncate(r.desc, 1500) : '', // keep enough JD for resume tailoring
      nextStep: '',
      createdAt: now,
      updatedAt: now
    };
  }

  function saveResult(r, btn) {
    const link = safeUrl(r.url || '');
    if (link && savedUrls().has(link.toLowerCase())) {
      markSaved(btn);
      showToast('Already in tracker.');
      return;
    }
    jobs.push(buildJob(r, 'Wishlist'));
    if (!save(STORAGE.jobs, jobs)) { jobs.pop(); return; } // save() already toasted
    markSaved(btn);
    renderJobs();
    renderDashboard();
    showToast('Saved to tracker.');
  }

  // Apply: track as Applied, open the posting, and load the JD into the resume tailor.
  function applyResult(r) {
    const link = safeUrl(r.url || '');
    let job = link ? jobs.find((j) => j.link && j.link.toLowerCase() === link.toLowerCase()) : null;
    if (job) {
      job.status = 'Applied';
      job.updatedAt = new Date().toISOString();
      if (!job.date) job.date = todayLocal();
    } else {
      job = buildJob(r, 'Applied');
      jobs.push(job);
    }
    save(STORAGE.jobs, jobs);
    renderJobs();
    renderDashboard();
    if (link) window.open(link, '_blank', 'noopener');
    if (typeof window.JT_loadJD === 'function') {
      window.JT_loadJD(r.desc || job.notes || '', (r.title || '') + (r.company ? ' @ ' + r.company : ''));
    }
    showToast('Tracking as Applied — tailor your resume & submit on the site.');
  }

  function markSaved(btn) {
    if (!btn) return;
    btn.textContent = 'Saved ✓';
    btn.disabled = true;
    btn.classList.add('saved');
  }

  // ---- rendering ----
  function renderResults(list) {
    dResults.replaceChildren();
    if (!list.length) {
      dResults.appendChild(el('div', { class: 'empty' }, 'No matching jobs. Try broader keywords or different sources.'));
      return;
    }
    const saved = savedUrls();
    list.forEach((r) => {
      const link = safeUrl(r.url || '');
      const isSaved = link && saved.has(link.toLowerCase());

      const meta = [];
      if (r.company) meta.push(el('span', { class: 'r-company' }, r.company));
      if (r.location) meta.push(el('span', { class: 'r-loc' }, r.location));
      if (r.salary) meta.push(el('span', { class: 'r-salary' }, r.salary));
      const dateStr = fmtDate(r.date);
      if (dateStr) meta.push(el('span', { class: 'r-date' }, dateStr));

      const tags = (r.tags || []).filter(Boolean).slice(0, 6)
        .map((t) => el('span', { class: 'r-tag' }, truncate(String(t), 24)));

      const actions = [];
      if (link) actions.push(el('a', { class: 'btn-link', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'View'));
      const saveBtn = el('button', { class: 'btn-primary' + (isSaved ? ' saved' : '') }, isSaved ? 'Saved ✓' : 'Save');
      if (isSaved) saveBtn.disabled = true;
      else saveBtn.addEventListener('click', () => saveResult(r, saveBtn));
      actions.push(saveBtn);

      const applyBtn = el('button', { class: 'btn-apply' }, 'Apply →');
      applyBtn.addEventListener('click', () => applyResult(r));
      actions.push(applyBtn);

      const insightBox = el('div', { class: 'r-insight' });
      if (AI.available && r.desc) {
        const insBtn = el('button', { class: 'btn-ai-sm' }, '✨ Insight');
        insBtn.addEventListener('click', () => loadInsight(r, insBtn, insightBox));
        actions.push(insBtn);
      }

      const headChildren = [
        el('h3', { class: 'r-title' }, r.title || '(untitled)'),
        el('span', { class: 'r-source badge ' + slug(r.source) }, r.source)
      ];
      if (typeof r._score === 'number') {
        headChildren.splice(1, 0, el('span', { class: 'fit-badge ' + fitClass(r._score) }, r._score + '% fit'));
      }

      dResults.appendChild(el('div', { class: 'result-card' }, [
        el('div', { class: 'r-head' }, headChildren),
        r._reason ? el('div', { class: 'r-reason' }, '★ ' + r._reason) : null,
        el('div', { class: 'r-meta' }, meta),
        tags.length ? el('div', { class: 'r-tags' }, tags) : null,
        r.desc ? el('p', { class: 'r-desc' }, truncate(r.desc, 220)) : null,
        el('div', { class: 'r-actions' }, actions),
        insightBox
      ]));
    });
  }

  function fitClass(s) { return s >= 75 ? 'fit-high' : s >= 45 ? 'fit-mid' : 'fit-low'; }

  // ---- AI: rank current results by fit ----
  async function rankByFit() {
    if (!lastResults.length) { showToast('Run a search first.'); return; }
    dRankBtn.disabled = true;
    const orig = dRankBtn.textContent;
    dRankBtn.textContent = 'Ranking…';
    try {
      const jobs = lastResults.slice(0, 30).map((j) => ({
        title: j.title, company: j.company, location: j.location, desc: j.desc
      }));
      const { rankings } = await postJSON('/api/ai/rank', { profile: aiProfile(), jobs });
      (rankings || []).forEach((rk) => {
        const t = lastResults[rk.i];
        if (t) { t._score = rk.score; t._reason = rk.reason; }
      });
      lastResults.sort((a, b) => (b._score || 0) - (a._score || 0));
      renderResults(lastResults);
      showToast('Ranked by fit.');
    } catch (e) {
      showToast('Rank failed: ' + e.message);
    } finally {
      dRankBtn.disabled = false;
      dRankBtn.textContent = orig;
    }
  }

  // ---- AI: per-job insight ----
  function renderInsight(ins, box) {
    box.replaceChildren();
    const meta = [ins.seniority && 'Seniority: ' + ins.seniority, ins.salaryHint && 'Salary: ' + ins.salaryHint]
      .filter(Boolean).join(' · ');
    if (meta) box.appendChild(el('div', { class: 'ins-meta' }, meta));
    const section = (title, items, cls) => {
      if (!items || !items.length) return;
      box.appendChild(el('div', { class: 'ins-sec ' + cls }, [
        el('b', {}, title),
        el('ul', {}, items.map((x) => el('li', {}, x)))
      ]));
    };
    section('Must-haves', ins.mustHaves, 'ins-must');
    section('Requirements', ins.requirements, 'ins-req');
    section('Red flags', ins.redFlags, 'ins-flag');
    if (!box.childNodes.length) box.appendChild(el('div', { class: 'muted' }, 'No insight extracted.'));
  }

  async function loadInsight(r, btn, box) {
    if (r._insightData) { renderInsight(r._insightData, box); return; } // cached — no API call
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Analyzing…';
    try {
      const ins = await postJSON('/api/ai/insight', {
        job: { title: r.title, company: r.company, location: r.location, desc: r.desc }
      });
      r._insightData = ins;
      renderInsight(ins, box);
    } catch (e) {
      box.replaceChildren(el('div', { class: 'st-fail' }, 'Insight failed: ' + e.message));
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  }

  // ---- Daily feed (written by the scheduled fetch) ----
  async function loadFeed() {
    dFeedBtn.disabled = true;
    setStatus(el('span', {}, 'Loading daily picks…'));
    try {
      const res = await fetch('data/jobs-feed.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no feed yet');
      const feed = await res.json();
      const jobs = Array.isArray(feed.jobs) ? feed.jobs : [];
      lastResults = jobs;
      setStatus(el('div', { class: 'status-line' }, [
        el('b', {}, jobs.length + ' daily pick' + (jobs.length === 1 ? '' : 's')),
        el('span', { class: 'muted' }, ' for “' + (feed.query || '') + '” · updated ' + fmtDate(feed.generatedAt))
      ]));
      renderResults(jobs);
    } catch {
      setStatus(el('span', { class: 'st-warn' }, 'No daily feed yet. It appears after the “Daily job fetch” GitHub Action runs (or run it manually from the Actions tab).'));
      dResults.replaceChildren();
    } finally {
      dFeedBtn.disabled = false;
    }
  }

  // ---- AI: tailor a cold email on the Email tab ----
  async function tailorEmail() {
    const kindSel = $('emailTemplate');
    const job = {
      title: ($('emRole') || {}).value || '',
      company: ($('emCompany') || {}).value || '',
      location: '',
      desc: ''
    };
    if (!job.title && !job.company) { showToast('Add a role/company first.'); return; }
    aiEmailBtn.disabled = true;
    const orig = aiEmailBtn.textContent;
    aiEmailBtn.textContent = 'Writing…';
    try {
      const out = await postJSON('/api/ai/email', {
        kind: kindSel ? kindSel.value : 'cold outreach',
        recipient: ($('emRecName') || {}).value || '',
        profile: aiProfile(),
        job
      });
      const subj = $('emSubject'); const bodyEl = $('emBody');
      if (subj) subj.value = out.subject || '';
      if (bodyEl) bodyEl.value = out.body || '';
      showToast('AI draft ready.');
    } catch (e) {
      showToast('Tailor failed: ' + e.message);
    } finally {
      aiEmailBtn.textContent = orig;
      aiEmailBtn.disabled = false;
    }
  }

  function setStatus(node) {
    dStatus.replaceChildren();
    if (node) dStatus.appendChild(node);
  }

  // ---- search orchestration ----
  let searching = false;
  async function runSearch() {
    if (searching) return;
    const q = dQuery.value.trim();
    const loc = dLocation.value.trim().toLowerCase();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

    const enabled = [...document.querySelectorAll('.source-toggles input[data-source]')]
      .filter((c) => c.checked).map((c) => c.dataset.source);

    const tasks = enabled.map((s) => ({ name: SOURCE_LABEL[s], run: () => ADAPTERS[s](q, loc) }));

    const ats = (document.querySelector('input[name="ats"]:checked') || {}).value || '';
    const slugVal = dCompanySlug.value.trim();
    if (ats && slugVal) {
      tasks.push({ name: SOURCE_LABEL[ats] + ' · ' + slugVal, run: () => ADAPTERS[ats](slugVal) });
    } else if (ats && !slugVal) {
      setStatus(el('span', { class: 'st-warn' }, 'Enter a company slug for the ' + SOURCE_LABEL[ats] + ' board, or set it to Off.'));
      return;
    }

    if (!tasks.length) {
      setStatus(el('span', { class: 'st-warn' }, 'Select at least one source.'));
      return;
    }

    searching = true;
    dSearchBtn.disabled = true;
    dSearchBtn.textContent = 'Searching…';
    setStatus(el('span', {}, 'Querying ' + tasks.length + ' source' + (tasks.length > 1 ? 's' : '') + '…'));
    dResults.replaceChildren();

    const settled = await Promise.allSettled(tasks.map((t) => t.run()));

    let all = [];
    const summary = [];
    settled.forEach((res, i) => {
      const name = tasks[i].name;
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        const clean = res.value.filter((j) => j && j.title);
        all = all.concat(clean);
        summary.push(el('span', { class: 'st-ok' }, name + ' (' + clean.length + ')'));
      } else {
        const reason = res.reason && res.reason.name === 'AbortError' ? 'timeout' : 'unavailable';
        summary.push(el('span', { class: 'st-fail', title: String(res.reason || '') }, name + ' (' + reason + ')'));
      }
    });

    let filtered = dedupe(all.filter((j) => matches(j, terms, loc)));
    let relaxedNote = '';
    // Location is a soft filter: these are remote-first boards, so a strict geo
    // match often wipes out otherwise-good keyword hits. Fall back gracefully.
    if (!filtered.length && loc && all.length) {
      const keywordOnly = dedupe(all.filter((j) => matches(j, terms, '')));
      if (keywordOnly.length) {
        filtered = keywordOnly;
        relaxedNote = 'No location match for “' + loc + '” (these boards are mostly remote) — showing all keyword matches.';
      }
    }
    filtered.sort((a, b) => {
      const da = new Date(a.date || 0).getTime() || 0;
      const db = new Date(b.date || 0).getTime() || 0;
      return db - da;
    });
    const capped = filtered.slice(0, 250);

    const statusWrap = el('div', { class: 'status-line' }, [
      el('b', {}, capped.length + ' result' + (capped.length === 1 ? '' : 's')),
      filtered.length > capped.length ? el('span', { class: 'muted' }, ' (showing first 250) ') : ' ',
      el('span', { class: 'src-pills' }, summary),
      relaxedNote ? el('div', { class: 'relaxed-note muted' }, relaxedNote) : null
    ]);
    setStatus(statusWrap);
    lastResults = capped;
    renderResults(capped);

    searching = false;
    dSearchBtn.disabled = false;
    dSearchBtn.textContent = 'Search';
  }

  // ---- wire up ----
  dSearchBtn.addEventListener('click', runSearch);
  [dQuery, dLocation, dCompanySlug].forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  });
  if (dRankBtn) dRankBtn.addEventListener('click', rankByFit);
  if (dFeedBtn) dFeedBtn.addEventListener('click', loadFeed);
  if (aiEmailBtn) aiEmailBtn.addEventListener('click', tailorEmail);

  checkAI();
})();
