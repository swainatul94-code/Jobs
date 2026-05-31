'use strict';
// Standalone job fetcher for scheduled automation (GitHub Action or cron).
// Queries public boards server-side (no CORS limits), filters, dedupes, and
// writes data/jobs-feed.json. The app loads that feed as a "Daily picks" list.
const fs = require('fs');
const path = require('path');

const QUERY = (process.env.FETCH_QUERY || 'qa automation').trim();
const LOCATION = (process.env.FETCH_LOCATION || '').trim().toLowerCase();
const OUT = path.join(__dirname, '..', 'data', 'jobs-feed.json');

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function money(min, max, cur) {
  const c = cur ? String(cur).trim() + ' ' : '';
  if (min && max && min !== max) return c + min + ' – ' + c + max;
  if (min || max) return c + (min || max);
  return '';
}
async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const SOURCES = {
  async Remotive(q) {
    const d = await getJSON('https://remotive.com/api/remote-jobs?limit=100' + (q ? '&search=' + encodeURIComponent(q) : ''));
    return (d.jobs || []).map((j) => ({
      source: 'Remotive', title: j.title, company: j.company_name,
      location: j.candidate_required_location || 'Remote', salary: j.salary || '',
      tags: j.tags || [], url: j.url, date: j.publication_date, desc: stripHtml(j.description)
    }));
  },
  async RemoteOK() {
    const d = await getJSON('https://remoteok.com/api');
    return (Array.isArray(d) ? d : []).filter((j) => j && j.position && j.url).map((j) => ({
      source: 'RemoteOK', title: j.position, company: j.company, location: j.location || 'Remote',
      salary: money(j.salary_min, j.salary_max, '$'), tags: j.tags || [], url: j.url, date: j.date, desc: stripHtml(j.description)
    }));
  },
  async Arbeitnow() {
    const d = await getJSON('https://www.arbeitnow.com/api/job-board-api');
    return (d.data || []).map((j) => ({
      source: 'Arbeitnow', title: j.title, company: j.company_name, location: j.location || (j.remote ? 'Remote' : ''),
      salary: '', tags: (j.tags || []).concat(j.job_types || []), url: j.url, date: j.created_at, desc: stripHtml(j.description)
    }));
  },
  async Jobicy() {
    const d = await getJSON('https://jobicy.com/api/v2/remote-jobs?count=100');
    return (d.jobs || []).map((j) => ({
      source: 'Jobicy', title: j.jobTitle, company: j.companyName, location: j.jobGeo || 'Remote',
      salary: '', tags: [].concat(j.jobIndustry || [], j.jobType || []), url: j.url, date: j.pubDate, desc: stripHtml(j.jobExcerpt)
    }));
  }
};

function matches(j, terms, loc) {
  if (terms.length) {
    const hay = [j.title, j.company, j.location, (j.tags || []).join(' '), j.desc].join(' ').toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  if (loc) {
    const full = [j.location, j.title, j.desc].join(' ').toLowerCase();
    if (!full.includes(loc)) return false;
  }
  return true;
}

(async () => {
  const terms = QUERY.toLowerCase().split(/\s+/).filter(Boolean);
  const names = Object.keys(SOURCES);
  const settled = await Promise.allSettled(names.map((n) => SOURCES[n](QUERY)));
  let all = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') { all = all.concat(r.value.filter((j) => j && j.title)); console.log(names[i], r.value.length); }
    else console.log(names[i], 'FAILED', r.reason && r.reason.message);
  });

  let filtered = all.filter((j) => matches(j, terms, LOCATION));
  if (!filtered.length && LOCATION) filtered = all.filter((j) => matches(j, terms, ''));

  const seen = new Set();
  const deduped = [];
  for (const j of filtered) {
    const k = (j.url || j.source + j.title + j.company).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(j);
  }
  deduped.sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)));

  const feed = { generatedAt: new Date().toISOString(), query: QUERY, location: LOCATION, count: deduped.length, jobs: deduped.slice(0, 100) };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(feed, null, 2));
  console.log('Wrote ' + feed.count + ' jobs to ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
