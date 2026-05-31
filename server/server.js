'use strict';
// Job Tracker backend: serves the static app and proxies AI calls to Anthropic
// so the API key never reaches the browser. Only dependency: express.
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Per-task model routing for cost control. AI_MODEL sets the global default
// (cheapest sensible model); override any single task via its own env var —
// e.g. bump only resume tailoring to Sonnet for quality, keep the rest on Haiku.
const DEFAULT_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const MODELS = {
  rank: process.env.AI_MODEL_RANK || DEFAULT_MODEL,
  insight: process.env.AI_MODEL_INSIGHT || DEFAULT_MODEL,
  email: process.env.AI_MODEL_EMAIL || DEFAULT_MODEL,
  resume: process.env.AI_MODEL_RESUME || DEFAULT_MODEL
};

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- Anthropic helper ----------
// Content-block builders. cached() marks a block for prompt caching so the
// stable prefix (system prompt, resume) is billed at ~10% on subsequent calls.
const cached = (text) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } });
const textBlock = (text) => ({ type: 'text', text });

async function callClaude({ model, system, messages, maxTokens = 1024 }) {
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
        model: model || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages
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
app.get('/api/ai/health', (_req, res) => res.json({ ok: true, ai: !!ANTHROPIC_KEY, model: DEFAULT_MODEL, models: MODELS }));

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
    const out = extractJSON(await callClaude({
      model: MODELS.rank,
      system: [cached(system)],
      messages: [{ role: 'user', content: user }],
      maxTokens: 1500
    }));
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
    const out = extractJSON(await callClaude({
      model: MODELS.email,
      system: [cached(system)],
      messages: [{ role: 'user', content: user }],
      maxTokens: 900
    }));
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
    const out = extractJSON(await callClaude({
      model: MODELS.insight,
      system: [cached(system)],
      messages: [{ role: 'user', content: user }],
      maxTokens: 900
    }));
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

// Extract plain text from an uploaded resume (PDF / DOCX / TXT / MD).
app.post('/api/resume/extract', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
      const name = (req.file.originalname || '').toLowerCase();
      const buf = req.file.buffer;
      let text = '';
      if (name.endsWith('.pdf')) {
        const pdf = require('pdf-parse/lib/pdf-parse.js'); // avoid the index debug shim
        text = (await pdf(buf)).text || '';
      } else if (name.endsWith('.docx')) {
        const mammoth = require('mammoth');
        text = (await mammoth.extractRawText({ buffer: buf })).value || '';
      } else if (name.endsWith('.txt') || name.endsWith('.md')) {
        text = buf.toString('utf8');
      } else if (name.endsWith('.doc')) {
        return res.status(415).json({ error: 'Legacy .doc not supported — save as .docx or PDF.' });
      } else {
        return res.status(415).json({ error: 'Unsupported type. Use PDF, DOCX, TXT, or MD.' });
      }
      text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) return res.status(422).json({ error: 'No text found (scanned/image PDF?). Paste it manually.' });
      res.json({ text: text.slice(0, 20000) });
    } catch (e) { res.status(500).json({ error: 'Extraction failed: ' + e.message }); }
  });
});

// Rewrite a resume to target a specific job description (truthfully).
app.post('/api/ai/resume', async (req, res) => {
  try {
    const resume = str(req.body && req.body.resume, 18000);
    const jd = str(req.body && req.body.jd, 8000);
    if (!resume) return res.status(400).json({ error: 'No resume provided.' });
    if (!jd) return res.status(400).json({ error: 'No job description provided.' });
    const profile = profileLine(req.body && req.body.profile);
    const system =
      'You are an expert resume editor. Rewrite the candidate resume to target the given job description: ' +
      'surface the most relevant skills and achievements, mirror important keywords for ATS, sharpen the ' +
      'summary, and reorder sections for relevance. Stay strictly truthful — never invent employers, dates, ' +
      'titles, certifications, or skills the original resume does not support. Return ONLY the tailored resume ' +
      'in clean Markdown, no commentary.';
    // Cache the stable prefix (system + profile + resume) so tailoring the same
    // resume to many different JDs only re-bills the small JD block each time.
    const out = await callClaude({
      model: MODELS.resume,
      system: [cached(system)],
      messages: [{ role: 'user', content: [
        cached(`CANDIDATE PROFILE: ${profile}\n\n=== CURRENT RESUME ===\n${resume}`),
        textBlock(`\n\n=== JOB DESCRIPTION (tailor the resume to this) ===\n${jd}`)
      ] }],
      maxTokens: 2500
    });
    if (!out) return res.status(502).json({ error: 'AI returned nothing.' });
    res.json({ resume: out });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- static app ----------
app.use(express.static(ROOT, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log(`Job Tracker running at http://localhost:${PORT}`);
  if (ANTHROPIC_KEY) {
    console.log('AI: enabled — rank=' + MODELS.rank + ' insight=' + MODELS.insight + ' email=' + MODELS.email + ' resume=' + MODELS.resume);
  } else {
    console.log('AI: DISABLED — set ANTHROPIC_API_KEY in .env');
  }
});
