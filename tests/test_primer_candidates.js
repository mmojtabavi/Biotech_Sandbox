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
  // ---- Test 1: pickPrimerCandidates top result matches pickPrimer exactly, for all real targets ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    for (const target of ['egfp', 'lacz', 'ubq', 'practice']) {
      w.document.getElementById('target').value = target;
      w.loadTarget();
      const t = S("clean(document.getElementById('template').value)");
      const [F, R] = w.primerRegions();
      const biasF = target !== 'practice';
      const single = w.pickPrimer(t, F[0], F[1], false, biasF);
      const multi = w.pickPrimerCandidates(t, F[0], F[1], false, biasF, 5);
      check(`${target}: fwd top candidate seq matches pickPrimer`, multi[0].seq === single.seq);
      check(`${target}: fwd top candidate pos matches pickPrimer`, multi[0].pos === single.pos);
      const singleR = w.pickPrimer(t, R[0], R[1], true);
      const multiR = w.pickPrimerCandidates(t, R[0], R[1], true, false, 5);
      check(`${target}: rev top candidate seq matches pickPrimer`, multiR[0].seq === singleR.seq);
    }
    dom.window.close();
  }

  // ---- Test 2: candidates are sorted ascending by score, exactly 5 returned when available ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.document.getElementById('target').value = 'egfp';
    w.loadTarget();
    const t = S("clean(document.getElementById('template').value)");
    const cands = w.pickPrimerCandidates(t, 0, 20, false, true, 5);
    check('exactly 5 candidates returned', cands.length === 5);
    let sorted = true;
    for (let i = 1; i < cands.length; i++) if (cands[i].score < cands[i-1].score) sorted = false;
    check('candidates sorted ascending by score', sorted);
    check('every candidate has real Tm/GC/hairpin fields', cands.every(c => typeof c.tmVal === 'number' && typeof c.gcVal === 'number' && typeof c.hairpinRun === 'number'));
    dom.window.close();
  }

  // ---- Test 3: topN param respected ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const seq = 'ACGT'.repeat(60); // 240bp synthetic
    const cands3 = w.pickPrimerCandidates(seq, 0, 40, false, false, 3);
    check('topN=3 returns 3', cands3.length === 3);
    const candsDefault = w.pickPrimerCandidates(seq, 0, 40, false, false);
    check('default topN is 5', candsDefault.length === 5);
    dom.window.close();
  }

  // ---- Test 4: pickPrimer returns null when no window fits (regression of edge case) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const res = w.pickPrimer('ACGT', 0, 0, false, false); // template too short for any 20-24bp window
    check('pickPrimer returns null on impossible region', res === null);
    const candsEmpty = w.pickPrimerCandidates('ACGT', 0, 0, false, false, 5);
    check('pickPrimerCandidates returns empty array on impossible region', Array.isArray(candsEmpty) && candsEmpty.length === 0);
    dom.window.close();
  }

  // ---- Test 5: renderPrimerCandidates populates both tables on boot (via loadTarget->suggestPrimers) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    const fwdHtml = d.getElementById('fwdCandidates').innerHTML;
    const revHtml = d.getElementById('revCandidates').innerHTML;
    check('fwdCandidates populated on default boot', fwdHtml.includes('<table'));
    check('revCandidates populated on default boot', revHtml.includes('<table'));
    check('fwd table has a winner row', fwdHtml.includes('winner'));
    check('fwd table shows start-offset column (real target)', fwdHtml.includes('Start offset'));
    check('zero console errors on boot', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 6: practice target has no start-offset column (biasStart not applied) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'practice';
    w.loadTarget();
    const fwdHtml = d.getElementById('fwdCandidates').innerHTML;
    check('practice target: no start-offset column', !fwdHtml.includes('Start offset'));
    dom.window.close();
  }

  // ---- Test 7: useCandidate swaps the field and clears that field's tailInfo ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    d.getElementById('tailEnzymeFwd').value = 'EcoRI';
    d.getElementById('tailEnzymeRev').value = 'EcoRI';
    w.addCloningTails();
    check('pre: fwd tailInfo set', !!S('tailInfo.fwd'));
    const t = S("clean(document.getElementById('template').value)");
    const [F] = w.primerRegions();
    const cands = w.pickPrimerCandidates(t, F[0], F[1], false, true, 5);
    const runnerUp = cands[1] || cands[0];
    w.useCandidate('fwd', runnerUp.seq);
    check('useCandidate: fwd field updated', d.getElementById('fwd').value === runnerUp.seq);
    check('useCandidate: fwd tailInfo cleared', S('tailInfo.fwd') === null);
    check('useCandidate: rev tailInfo untouched', !!S('tailInfo.rev'));
    dom.window.close();
  }

  // ---- Test 8: renderPrimerCandidates re-runs after each preset without throwing, all targets ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    let threw = false;
    for (const target of ['egfp', 'lacz', 'ubq', 'practice']) {
      d.getElementById('target').value = target;
      try {
        w.loadTarget();
        for (const preset of ['clean', 'mm3', 'lowtm', 'nonspec']) w.loadPreset(preset);
      } catch (e) { threw = true; console.log('candidate render error', target, e.message); }
    }
    check('candidate rendering survives all targets/presets without throw', !threw);
    check('zero console errors after full sweep', errors.length === 0);
    const fwdHtml = d.getElementById('fwdCandidates').innerHTML;
    check('candidates table still well-formed after sweep', fwdHtml.includes('<table') && !fwdHtml.includes('NaN') && !fwdHtml.includes('undefined'));
    dom.window.close();
  }

  // ---- Test 9: full existing-feature regression spot-check (Gibson still works alongside this change) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('gibson still succeeds after primer-candidate change', S('!!lastLigate') && S('lastLigate.method') === 'gibson');
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
