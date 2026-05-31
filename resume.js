// ========= RESUME: upload, store, AI-tailor to a JD =========
// Uses globals from app.js: el, showToast, todayLocal, profile.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const resumeText = $('resumeText');
  if (!resumeText) return;

  const KEY = 'jt_resume';
  const fileInput = $('resumeFile');
  const jdText = $('jdText');
  const jdSource = $('jdSource');
  const tailoredText = $('tailoredText');
  const tailorBtn = $('tailorBtn');
  const tailorHint = $('tailorHint');
  const resumeMeta = $('resumeMeta');

  // ---- load stored master resume ----
  try {
    const saved = localStorage.getItem(KEY);
    if (saved != null) resumeText.value = saved;
  } catch { /* ignore */ }
  updateMeta();

  function updateMeta() {
    const len = (resumeText.value || '').trim().length;
    resumeMeta.textContent = len ? len.toLocaleString() + ' chars saved' : 'No resume saved yet';
  }

  function saveResume() {
    try {
      localStorage.setItem(KEY, resumeText.value || '');
      updateMeta();
      showToast('Resume saved.');
    } catch { showToast('Could not save (storage full?).'); }
  }

  // ---- AI availability ----
  async function checkAI() {
    let ai = false, model = '';
    try { const d = await (await fetch('/api/ai/health')).json(); ai = !!(d && d.ai); model = (d && d.model) || ''; }
    catch { ai = false; }
    tailorBtn.hidden = !ai;
    tailorHint.textContent = ai
      ? 'AI ready · ' + model
      : 'AI off — start the backend with an ANTHROPIC_API_KEY to tailor resumes.';
  }

  // ---- upload + extract ----
  async function handleUpload(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('File too large (max 8MB).'); return; }
    showToast('Extracting…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const f = window.JT_aiFetch || fetch;
      const res = await f('/api/resume/extract', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      resumeText.value = data.text || '';
      saveResume();
      showToast('Resume loaded from ' + file.name + '.');
    } catch (e) {
      showToast('Upload failed: ' + e.message);
    }
  }

  // ---- AI tailor ----
  async function tailor() {
    const resume = (resumeText.value || '').trim();
    const jd = (jdText.value || '').trim();
    if (!resume) { showToast('Add your resume first.'); return; }
    if (!jd) { showToast('Paste a job description first.'); jdText.focus(); return; }
    tailorBtn.disabled = true;
    const orig = tailorBtn.textContent;
    tailorBtn.textContent = 'Tailoring…';
    try {
      const aiProfile = (typeof profile === 'object' && profile)
        ? { name: profile.name, years: profile.years, skills: profile.skills } : {};
      const f = window.JT_aiFetch || fetch;
      const res = await f('/api/ai/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resume, jd, profile: aiProfile })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      tailoredText.value = data.resume || '';
      showToast('Tailored resume ready — review & download.');
      tailoredText.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      showToast('Tailor failed: ' + e.message);
    } finally {
      tailorBtn.textContent = orig;
      tailorBtn.disabled = false;
    }
  }

  // ---- markdown -> html (for .doc export and print) ----
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');
  function mdToHtml(md) {
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of String(md).split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(esc(line.replace(/^\s*[-*]\s+/, ''))) + '</li>';
        continue;
      }
      closeList();
      if (/^#{1,6}\s/.test(line)) {
        const lvl = line.match(/^#+/)[0].length;
        html += '<h' + lvl + '>' + inline(esc(line.replace(/^#+\s/, ''))) + '</h' + lvl + '>';
      } else if (line === '') {
        html += '';
      } else {
        html += '<p>' + inline(esc(line)) + '</p>';
      }
    }
    closeList();
    return html;
  }
  function fullHtml(body) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resume</title>' +
      '<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;max-width:800px;margin:24px auto;color:#111}' +
      'h1{font-size:20pt;margin:0 0 4px}h2{font-size:13pt;border-bottom:1px solid #ccc;padding-bottom:2px;margin:16px 0 6px}' +
      'h3{font-size:11.5pt;margin:10px 0 2px}ul{margin:4px 0 8px 18px}p{margin:4px 0}</style></head><body>' +
      body + '</body></html>';
  }

  function downloadBlob(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function requireTailored() {
    const t = (tailoredText.value || '').trim();
    if (!t) { showToast('Tailor a resume first.'); return null; }
    return t;
  }

  // ---- wire up ----
  $('resumeUploadBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { handleUpload(e.target.files[0]); e.target.value = ''; });
  $('saveResume').addEventListener('click', saveResume);
  tailorBtn.addEventListener('click', tailor);

  $('copyTailored').addEventListener('click', async () => {
    const t = requireTailored(); if (!t) return;
    try { await navigator.clipboard.writeText(t); showToast('Copied.'); }
    catch { showToast('Copy failed.'); }
  });
  $('dlTailoredMd').addEventListener('click', () => {
    const t = requireTailored(); if (!t) return;
    downloadBlob(t, 'text/markdown', 'resume-tailored-' + todayLocal() + '.md');
  });
  $('dlTailoredDoc').addEventListener('click', () => {
    const t = requireTailored(); if (!t) return;
    downloadBlob(fullHtml(mdToHtml(t)), 'application/msword', 'resume-tailored-' + todayLocal() + '.doc');
  });
  $('printTailored').addEventListener('click', () => {
    const t = requireTailored(); if (!t) return;
    const html = fullHtml(mdToHtml(t) + '<script>window.onload=function(){window.print()}<\/script>');
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  // ---- bridge: let Apply buttons elsewhere load a JD here ----
  window.JT_loadJD = function (jd, label) {
    const btn = document.querySelector('[data-tab="resume"]');
    if (btn) btn.click();
    jdText.value = jd || '';
    jdSource.textContent = label ? '— ' + label : '';
    if (jd) showToast('JD loaded — tailor your resume below.');
    jdText.focus();
  };

  checkAI();
})();
