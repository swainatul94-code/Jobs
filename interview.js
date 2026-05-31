// ========= INTERVIEW PREP: AI questions + tips from a JD =========
// Uses globals from app.js (el, showToast, profile) and window.JT_aiFetch.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ivJD = $('ivJD');
  const ivBtn = $('ivBtn');
  const ivHint = $('ivHint');
  const ivOutput = $('ivOutput');
  if (!ivBtn) return;

  async function checkAI() {
    let ai = false, model = '';
    try { const d = await (await fetch('/api/ai/health')).json(); ai = !!(d && d.ai); model = (d && d.model) || ''; }
    catch { ai = false; }
    ivBtn.hidden = !ai;
    ivHint.textContent = ai ? 'AI ready · ' + model
      : 'AI off — start the backend with an ANTHROPIC_API_KEY to generate interview prep.';
  }

  function masterResume() {
    try { return localStorage.getItem('jt_resume') || ''; } catch { return ''; }
  }

  function render(data) {
    ivOutput.replaceChildren();
    if (data.topics && data.topics.length) {
      ivOutput.appendChild(el('div', { class: 'iv-topics' }, [
        el('h3', {}, 'Topics to revise'),
        el('div', { class: 'iv-chips' }, data.topics.map((t) => el('span', { class: 'iv-chip' }, t)))
      ]));
    }
    const qs = data.questions || [];
    if (!qs.length) {
      ivOutput.appendChild(el('p', { class: 'muted' }, 'No questions generated.'));
      return;
    }
    ivOutput.appendChild(el('h3', {}, qs.length + ' likely questions'));
    const ol = el('ol', { class: 'iv-qlist' });
    qs.forEach((item) => {
      ol.appendChild(el('li', {}, [
        el('div', { class: 'iv-q' }, item.q),
        item.tip ? el('div', { class: 'iv-tip' }, [el('b', {}, 'Tip: '), item.tip]) : null
      ]));
    });
    ivOutput.appendChild(ol);
  }

  async function generate() {
    const jd = (ivJD.value || '').trim();
    if (!jd) { showToast('Paste a job description first.'); ivJD.focus(); return; }
    ivBtn.disabled = true;
    const orig = ivBtn.textContent;
    ivBtn.textContent = 'Generating…';
    ivOutput.replaceChildren(el('p', { class: 'muted' }, 'Thinking…'));
    try {
      const aiProfile = (typeof profile === 'object' && profile)
        ? { name: profile.name, years: profile.years, skills: profile.skills } : {};
      const f = window.JT_aiFetch || fetch;
      const res = await f('/api/ai/interview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jd, profile: aiProfile, resume: masterResume() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      render(data);
      showToast('Interview prep ready.');
    } catch (e) {
      ivOutput.replaceChildren(el('div', { class: 'st-fail' }, 'Failed: ' + e.message));
    } finally {
      ivBtn.textContent = orig;
      ivBtn.disabled = false;
    }
  }

  ivBtn.addEventListener('click', generate);
  checkAI();
})();
