const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'pcr-lab.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name); }
}

function boot() {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  dom.window.onerror = (msg) => errors.push(msg);
  const w = dom.window;
  const S = (expr) => w.eval(expr);
  return { dom, w, S, errors };
}

(async () => {
  // ---- Test 1: BACKGROUND_GENOME is well-formed and distinct from all real targets ----
  {
    const { dom, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const bg = S('BACKGROUND_GENOME');
    check('BACKGROUND_GENOME is 6000 bp', bg.length === 6000);
    check('BACKGROUND_GENOME is pure ACGT', /^[ACGT]+$/.test(bg));
    check('BACKGROUND_GENOME differs from the practice template (different seed)', bg !== S('mkTemplate(7)'));
    dom.window.close();
  }

  // ---- Test 2: productiveSiteCount / offTargetCount correctness ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const bg = S('BACKGROUND_GENOME');
    const plantedPrimer = bg.slice(1000, 1020); // exact match, guaranteed productive at any reasonable atemp
    check('a primer planted straight from the background scores >=1 off-target hit', w.offTargetCount(plantedPrimer, bg, 58) >= 1);
    const junkPrimer = 'ACACACACACACACACACAC'; // low-complexity, shouldn't productively match a real template
    const egfp = S('EGFP');
    check('a junk primer finds no productive site on EGFP', w.productiveSiteCount(junkPrimer, egfp, '+', 58) === 0);
    dom.window.close();
  }

  // ---- Test 3: scoreSpecificity structure & sane bounds ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const egfp = S('EGFP');
    const fwd = egfp.slice(0, 20), rev = S('revcomp')(egfp.slice(-20));
    const r = w.scoreSpecificity(fwd, rev, egfp, 58);
    check('score is a number 0-100', typeof r.score === 'number' && r.score >= 0 && r.score <= 100);
    check('breakdown has exactly 4 components', r.breakdown.length === 4);
    check('every breakdown penalty is a non-negative number', r.breakdown.every(b => typeof b.penalty === 'number' && b.penalty >= 0));
    check('every breakdown has a label and detail string', r.breakdown.every(b => typeof b.label === 'string' && typeof b.detail === 'string' && b.detail.length > 0));
    dom.window.close();
  }

  // ---- Test 4: clean default primers score well on every real target; broken presets score worse ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    const scores = {};
    for (const t of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
      doc.getElementById('target').value = t;
      w.loadTarget();
      const fwd = doc.getElementById('fwd').value, rev = doc.getElementById('rev').value;
      const at = +doc.getElementById('atemp').value;
      const templ = doc.getElementById('template').value;
      const r = w.scoreSpecificity(fwd, rev, templ, at);
      scores[t] = r.score;
      check(`clean default primers score >=75 on ${t}`, r.score >= 75);
    }
    doc.getElementById('target').value = 'egfp';
    w.loadTarget();
    const cleanScore = w.scoreSpecificity(doc.getElementById('fwd').value, doc.getElementById('rev').value, doc.getElementById('template').value, +doc.getElementById('atemp').value).score;
    w.loadPreset('mm3');
    const mm3Score = w.scoreSpecificity(doc.getElementById('fwd').value, doc.getElementById('rev').value, doc.getElementById('template').value, +doc.getElementById('atemp').value).score;
    check('3′ mismatch preset scores meaningfully lower than clean', mm3Score < cleanScore - 5);
    doc.getElementById('target').value = 'egfp'; w.loadTarget();
    w.loadPreset('lowtm');
    const lowtmScore = w.scoreSpecificity(doc.getElementById('fwd').value, doc.getElementById('rev').value, doc.getElementById('template').value, +doc.getElementById('atemp').value).score;
    check('Low Tm preset scores meaningfully lower than clean', lowtmScore < cleanScore - 5);
    doc.getElementById('target').value = 'egfp'; w.loadTarget();
    w.loadPreset('nonspec');
    const nonspecScore = w.scoreSpecificity(doc.getElementById('fwd').value, doc.getElementById('rev').value, doc.getElementById('template').value, +doc.getElementById('atemp').value).score;
    check('Nonspecific preset scores lower than clean', nonspecScore < cleanScore);
    dom.window.close();
  }

  // ---- Test 5: full page boot wiring — Challenge 3 panel populates on Run PCR, zero console errors ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    check('zero console/window errors on default boot', errors.length === 0);
    const panel = doc.getElementById('specScoreOut').innerHTML;
    check('specificity panel is populated on default boot', panel.trim().length > 0);
    check('panel shows a numeric score', /\d+\s*<span/.test(panel) || /\d+\/100|>\d+</.test(panel));
    check('panel lists all 4 breakdown components', (panel.match(/<li/g) || []).length === 4);
    dom.window.close();
  }

  // ---- Test 6: re-running with a manually broken primer updates the score down, not stuck stale ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    const before = doc.getElementById('specScoreOut').innerHTML;
    doc.getElementById('rev').value = 'AC'; // absurdly short/broken primer
    w.run();
    await new Promise(r => setTimeout(r, 20));
    const after = doc.getElementById('specScoreOut').innerHTML;
    check('zero console/window errors with a degenerate primer', errors.length === 0);
    check('score panel updates (not stale) after a broken Run PCR', before !== after);
    dom.window.close();
  }

  // ---- Test 7: full target x preset sweep, zero errors (regression) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    for (const t of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
      doc.getElementById('target').value = t;
      w.loadTarget();
      for (const p of ['clean', 'mm3', 'lowtm', 'nonspec']) w.loadPreset(p);
    }
    check('zero console/window errors across full target x preset sweep incl. specificity scoring', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 8: lab report includes the Specificity Score section ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const report = w.document.getElementById('reportOut').value;
    check('zero console/window errors generating a lab report', errors.length === 0);
    check('lab report mentions the Specificity Score', /Specificity Score/.test(report));
    dom.window.close();
  }

  // ---- Test 9: save/share round trip still works with the new feature present (no new fields needed) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.generateShareCode();
    const code = doc.getElementById('shareOut').value;
    check('a save code was generated', code && code.length > 0);
    const boot2 = boot();
    await new Promise(r => setTimeout(r, 60));
    boot2.w.document.getElementById('shareIn').value = code;
    boot2.w.loadShareCode();
    await new Promise(r => setTimeout(r, 30));
    check('zero console/window errors restoring a save code (specificity panel included)', boot2.errors.length === 0);
    const panel2 = boot2.w.document.getElementById('specScoreOut').innerHTML;
    check('restored session shows a populated specificity panel', panel2.trim().length > 0);
    dom.window.close(); boot2.dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
