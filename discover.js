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
    lever: 'Lever'
  };

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

  // ---- save a result into the tracker ----
  function saveResult(r, btn) {
    const link = safeUrl(r.url || '');
    if (link && savedUrls().has(link.toLowerCase())) {
      markSaved(btn);
      showToast('Already in tracker.');
      return;
    }
    const now = new Date().toISOString();
    jobs.push({
      id: uid(),
      company: String(r.company || '').slice(0, 2000),
      role: String(r.title || '').slice(0, 2000),
      location: String(r.location || '').slice(0, 2000),
      salary: String(r.salary || '').slice(0, 2000),
      status: 'Wishlist',
      date: todayLocal(),
      link,
      source: r.source || '',
      notes: r.desc ? truncate(r.desc, 500) : '',
      nextStep: '',
      createdAt: now,
      updatedAt: now
    });
    if (!save(STORAGE.jobs, jobs)) {
      jobs.pop();
      return; // save() already toasted the failure
    }
    markSaved(btn);
    renderJobs();
    renderDashboard();
    showToast('Saved to tracker.');
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

      dResults.appendChild(el('div', { class: 'result-card' }, [
        el('div', { class: 'r-head' }, [
          el('h3', { class: 'r-title' }, r.title || '(untitled)'),
          el('span', { class: 'r-source badge ' + slug(r.source) }, r.source)
        ]),
        el('div', { class: 'r-meta' }, meta),
        tags.length ? el('div', { class: 'r-tags' }, tags) : null,
        r.desc ? el('p', { class: 'r-desc' }, truncate(r.desc, 220)) : null,
        el('div', { class: 'r-actions' }, actions)
      ]));
    });
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

    const tasks = enabled.map((s) => ({ name: SOURCE_LABEL[s], run: () => ADAPTERS[s](q) }));

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
})();
