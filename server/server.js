'use strict';
// Job Tracker backend: serves the static app and proxies AI calls to Anthropic
// so the API key never reaches the browser. Only dependency: express.
const path = require('path');
const fs = require('fs');
const express = require('express');

// --- tiny .env loader (avoids a dotenv dependency) ---
(function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, '');
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch { /* no .env file is fine */ }
})();

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5500;
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Anthropic helper ----------
async function callClaude(system, userText, maxTokens = 1024) {
  if (!ANTHROPIC_KEY) {
    const err = new Error('AI not configured: set ANTHROPIC_API_KEY in .env');
    err.status = 503;
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userText }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('Anthropic HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status === 401 ? 401 : 502;
      throw err;
    }
    return (data.content || []).map((b) => b.text || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

// Pull the first JSON value out of a model response (tolerates prose/code fences).
function extractJSON(text) {
  if (!text) return null;
  let t = text.replace(/```json|```/gi, '').trim();
  const first = t.search(/[[{]/);
  if (first < 0) return null;
  // find matching close by scanning
  const open = t[first];
  const close = open === '[' ? ']' : '}';
  let depth = 0, end = -1;
  for (let i = first; i < t.length; i++) {
    if (t[i] === open) depth++;
    else if (t[i] === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(t.slice(first, end + 1)); } catch { return null; }
}

const str = (v, n = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
function profileLine(p) {
  p = p || {};
  return [
    p.name && ('Name: ' + str(p.name, 120)),
    p.years && (str(p.years, 40) + ' years experience'),
    p.skills && ('Skills: ' + str(p.skills, 400)),
    p.headline && ('Headline: ' + str(p.headline, 200))
  ].filter(Boolean).join('. ') || '(no profile provided)';
}

// ---------- routes ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/ai/health', (_req, res) => res.json({ ok: true, ai: !!ANTHROPIC_KEY, model: AI_MODEL }));

// Rank/score a batch of jobs against the user profile.
app.post('/api/ai/rank', async (req, res) => {
  try {
    const jobs = Array.isArray(req.body && req.body.jobs) ? req.body.jobs.slice(0, 30) : [];
    if (!jobs.length) return res.status(400).json({ error: 'No jobs provided.' });
    const profile = profileLine(req.body.profile);
    const list = jobs.map((j, i) =>
      `[${i}] ${str(j.title, 160)} @ ${str(j.company, 120)} | ${str(j.location, 80)} | ${str(j.desc, 600)}`
    ).join('\n');
    const system =
      'You are a job-fit assistant. Given a candidate profile and a numbered list of jobs, ' +
      'score each job 0-100 for fit to the candidate and give a terse one-line reason. ' +
      'Respond ONLY with a JSON array: [{"i":<index>,"score":<0-100>,"reason":"..."}]. No prose.';
    const user = `CANDIDATE: ${profile}\n\nJOBS:\n${list}`;
    const out = extractJSON(await callClaude(system, user, 1500));
    if (!Array.isArray(out)) return res.status(502).json({ error: 'AI returned an unparseable ranking.' });
    const clean = out
      .filter((r) => r && Number.isInteger(r.i) && r.i >= 0 && r.i < jobs.length)
      .map((r) => ({ i: r.i, score: Math.max(0, Math.min(100, Number(r.score) || 0)), reason: str(r.reason, 200) }));
    res.json({ rankings: clean });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Write a tailored cold email / cover note for one job or recruiter.
app.post('/api/ai/email', async (req, res) => {
  try {
    const job = (req.body && req.body.job) || {};
    const profile = profileLine(req.body && req.body.profile);
    const kind = str((req.body && req.body.kind) || 'cold outreach', 60);
    const recipient = str((req.body && req.body.recipient) || '', 120);
    const system =
      'You write concise, specific, non-generic job-search emails. No fluff, no clichés. ' +
      'Respond ONLY as JSON: {"subject":"...","body":"..."}. Keep body under 180 words, ready to send.';
    const user =
      `TYPE: ${kind}\nRECIPIENT: ${recipient || '(unknown)'}\n` +
      `CANDIDATE: ${profile}\n\n` +
      `JOB: ${str(job.title, 160)} at ${str(job.company, 120)} (${str(job.location, 80)})\n` +
      `JOB DETAILS: ${str(job.desc, 1500)}`;
    const out = extractJSON(await callClaude(system, user, 900));
    if (!out || typeof out.body !== 'string') return res.status(502).json({ error: 'AI returned an unparseable email.' });
    res.json({ subject: str(out.subject, 200), body: str(out.body, 4000) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Summarize a job description into structured insight.
app.post('/api/ai/insight', async (req, res) => {
  try {
    const job = (req.body && req.body.job) || {};
    if (!str(job.desc) && !str(job.title)) return res.status(400).json({ error: 'No job content provided.' });
    const system =
      'Analyze a job posting. Respond ONLY as JSON: ' +
      '{"seniority":"...","salaryHint":"...","requirements":["..."],"mustHaves":["..."],"redFlags":["..."]}. ' +
      'Keep each array to at most 6 short bullet strings. Use "" or [] when unknown.';
    const user = `TITLE: ${str(job.title, 160)} @ ${str(job.company, 120)} (${str(job.location, 80)})\n\n${str(job.desc, 4000)}`;
    const out = extractJSON(await callClaude(system, user, 900));
    if (!out || typeof out !== 'object') return res.status(502).json({ error: 'AI returned an unparseable insight.' });
    const arr = (v) => (Array.isArray(v) ? v.slice(0, 6).map((x) => str(x, 200)) : []);
    res.json({
      seniority: str(out.seniority, 80),
      salaryHint: str(out.salaryHint, 120),
      requirements: arr(out.requirements),
      mustHaves: arr(out.mustHaves),
      redFlags: arr(out.redFlags)
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- static app ----------
app.use(express.static(ROOT, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log(`Job Tracker running at http://localhost:${PORT}`);
  console.log(`AI: ${ANTHROPIC_KEY ? 'enabled (' + AI_MODEL + ')' : 'DISABLED — set ANTHROPIC_API_KEY in .env'}`);
});
