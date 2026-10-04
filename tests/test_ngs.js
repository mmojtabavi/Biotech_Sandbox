const fs = require('fs');
const { JSDOM } = require('jsdom');

// Verifies the NGS-style multi-read sequencing feature (Step 5′), found already fully
// implemented (engine + UI + save/share + lab report) in an untracked pass at the start of
// this scheduled run (file modified 2026-08-29, after the last logged changelog entry of
// 2026-08-22) — same recurring pattern this project has hit many times before. Written from
// scratch since no dedicated test suite existed for it yet.

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
  // ---- Test 1: simulateNgsReads structure & determinism ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const egfp = S('EGFP');
    const sim = w.simulateNgsReads(egfp, 10);
    check('simulateNgsReads returns the right shape', typeof sim.L === 'number' && typeof sim.readLen === 'number' && Array.isArray(sim.reads));
    check('readLen is 150 (or the sequence length if shorter)', sim.readLen === Math.min(150, egfp.length));
    check('L matches the input sequence length', sim.L === egfp.length);
    check('every read has start/end/bases with the right length', sim.reads.every(r => r.bases.length === sim.readLen && r.end === r.start + sim.readLen - 1));
    check('every base is a real ACGT call', sim.reads.every(r => r.bases.every(b => 'ACGT'.includes(b.base))));

    const sim2 = w.simulateNgsReads(egfp, 10);
    check('deterministic: same nReads across two calls', sim.nReads === sim2.nReads);
    check('deterministic: same first read start across two calls', sim.reads[0].start === sim2.reads[0].start);
    check('deterministic: same base call at read0/pos0 across two calls', sim.reads[0].bases[0].base === sim2.reads[0].bases[0].base);

    const simOtherSeed = w.simulateNgsReads(S('LACZ'), 10);
    check('a different sequence produces a different read layout (seed depends on sequence)', simOtherSeed.reads[0].start !== sim.reads[0].start || simOtherSeed.nReads !== sim.nReads || simOtherSeed.reads.length !== sim.reads.length);
    dom.window.close();
  }

  // ---- Test 2: read coverage scales with requested depth ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const egfp = S('EGFP');
    const depths = [1, 4, 10, 30];
    const meanDepths = depths.map(d => {
      const sim = w.simulateNgsReads(egfp, d);
      const cons = w.ngsConsensus(sim);
      return cons.coverage.reduce((a, b) => a + b, 0) / cons.coverage.length;
    });
    check('mean achieved depth is close to the requested depth at every setting', depths.every((d, i) => Math.abs(meanDepths[i] - d) < 1.5));
    check('mean depth increases monotonically with requested depth', meanDepths[0] < meanDepths[1] && meanDepths[1] < meanDepths[2] && meanDepths[2] < meanDepths[3]);
    dom.window.close();
  }

  // ---- Test 3: consensus accuracy improves with depth — the core pedagogical claim ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const egfp = S('EGFP');
    const lowSim = w.simulateNgsReads(egfp, 1);
    const lowCons = w.ngsConsensus(lowSim);
    const lowAcc = w.ngsAccuracy(egfp, lowCons.consensus);
    const highSim = w.simulateNgsReads(egfp, 30);
    const highCons = w.ngsConsensus(highSim);
    const highAcc = w.ngsAccuracy(egfp, highCons.consensus);
    check('1x depth leaves at least one gap or mismatch (realistic low-depth failure)', (lowAcc.gaps + lowAcc.mismatches) > 0);
    check('30x depth reconstructs the exact original sequence (0 gaps, 0 mismatches)', highAcc.gaps === 0 && highAcc.mismatches === 0);
    check('30x depth has fewer (gaps+mismatches) than 1x depth', (highAcc.gaps + highAcc.mismatches) < (lowAcc.gaps + lowAcc.mismatches));
    dom.window.close();
  }

  // ---- Test 4: ngsConsensus majority-vote logic in isolation ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    // 3 reads covering a single position: 2 vote 'A', 1 votes 'G' -> consensus should be 'A'
    const fakeSim = { L: 1, reads: [
      { start: 0, end: 0, bases: [{ pos: 0, base: 'A', q: 38, err: false }] },
      { start: 0, end: 0, bases: [{ pos: 0, base: 'A', q: 38, err: false }] },
      { start: 0, end: 0, bases: [{ pos: 0, base: 'G', q: 38, err: true }] },
    ] };
    const cons = w.ngsConsensus(fakeSim);
    check('majority vote picks the 2-vote base over the 1-vote base', cons.consensus[0] === 'A');
    check('coverage correctly counts all 3 reads at that position', cons.coverage[0] === 3);

    const emptySim = { L: 2, reads: [] };
    const consEmpty = w.ngsConsensus(emptySim);
    check('zero-coverage position gets a null consensus call, not a wrong guess', consEmpty.consensus[0] === null && consEmpty.consensus[1] === null);
    check('zero-coverage position has coverage 0', consEmpty.coverage[0] === 0);
    dom.window.close();
  }

  // ---- Test 5: currentNgsSource gating — no PCR product yet / no ligated plasmid yet ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    doc.getElementById('ngsSource').value = 'plasmid';
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    check('gating message when no ligated plasmid exists yet', /ligate a construct/i.test(doc.getElementById('ngsSummary').textContent));
    check('lastNGS stays null when gated', w.eval('lastNGS') === null);
    doc.getElementById('ngsSource').value = 'product';
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    check('runNGS on default boot (PCR product exists) succeeds without a gating message', !/first — there/i.test(doc.getElementById('ngsSummary').textContent));
    dom.window.close();
  }

  // ---- Test 6: full page boot wiring, zero console errors, panel populates after clicking run ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    check('zero console/window errors on default boot', errors.length === 0);
    const doc = w.document;
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors after Simulate NGS run', errors.length === 0);
    const summary = doc.getElementById('ngsSummary').innerHTML;
    check('NGS summary populates with read/depth info', /reads/.test(summary) && /bp/.test(summary));
    const cov = doc.getElementById('ngsCoverageChart').innerHTML;
    const pu = doc.getElementById('ngsPileup').innerHTML;
    check('coverage chart SVG is populated', cov.includes('<svg') && cov.length > 100);
    check('pileup SVG is populated', pu.includes('<svg') && pu.length > 100);
    check('coverage chart aria-label is content-specific', /NGS coverage depth track/.test(cov));
    check('pileup aria-label is content-specific', /NGS read pileup/.test(pu));
    check('no NaN in either SVG', !/NaN/.test(cov) && !/NaN/.test(pu));
    dom.window.close();
  }

  // ---- Test 7: clearNGS resets state and DOM cleanly ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    w.clearNGS();
    check('lastNGS is null after clear', w.eval('lastNGS') === null);
    check('coverage chart is cleared', doc.getElementById('ngsCoverageChart').innerHTML === '');
    check('pileup is cleared', doc.getElementById('ngsPileup').innerHTML === '');
    check('zero console/window errors after clear', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 8: refreshNGS only re-simulates if the learner has already clicked Run once ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.refreshNGS(); // never clicked "Simulate NGS run" yet -> should be a no-op
    check('refreshNGS is a no-op before the first manual run', w.eval('lastNGS') === null);
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    const before = doc.getElementById('ngsCoverageChart').innerHTML;
    doc.getElementById('target').value = 'lacz';
    w.loadTarget(); // triggers refreshNGS() via the same hook run()/loadTarget() already call
    await new Promise(r => setTimeout(r, 20));
    const after = doc.getElementById('ngsCoverageChart').innerHTML;
    check('refreshNGS re-renders (not stale) once a manual run has happened', before !== after);
    check('zero console/window errors across refresh cycle', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 9: plasmid-source NGS after a real ligation ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    doc.getElementById('target').value = 'egfp';
    w.loadTarget();
    doc.getElementById('tailEnzymeFwd').value = 'EcoRI';
    doc.getElementById('tailEnzymeRev').value = 'EcoRI';
    w.addCloningTails();
    w.run();
    w.digestProduct();
    doc.getElementById('vecEnzyme').value = 'EcoRI';
    w.ligate();
    check('ligation succeeded (precondition for this test)', !!w.eval('lastLigate'));
    doc.getElementById('ngsSource').value = 'plasmid';
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors sequencing the ligated plasmid', errors.length === 0);
    const lastNGS = w.eval('lastNGS');
    check('NGS ran against the plasmid sequence, not the shorter PCR product', lastNGS.src.seq === w.eval('lastLigate.seq') && lastNGS.src.seq.length === w.eval('lastLigate.size'));
    check('plasmid source label mentions the recombinant plasmid', /recombinant plasmid/i.test(lastNGS.src.label));
    dom.window.close();
  }

  // ---- Test 10: colorblind toggle survives an NGS render ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    const before = doc.getElementById('ngsCoverageChart').innerHTML;
    w.toggleColorblindMode();
    await new Promise(r => setTimeout(r, 20));
    const after = doc.getElementById('ngsCoverageChart').innerHTML;
    check('zero console/window errors toggling colorblind mode with NGS results present', errors.length === 0);
    check('coverage chart re-renders (not blanked) after the colorblind toggle', after.includes('<svg') && after.length > 100);
    check('toggling colorblind mode actually changes the rendered chart (palette swap took effect)', before !== after);
    dom.window.close();
  }

  // ---- Test 11: full target sweep, zero errors, including an NGS run per target ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    for (const t of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
      doc.getElementById('target').value = t;
      w.loadTarget();
      w.runNGS();
    }
    check('zero console/window errors across a full 5-target NGS sweep', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 12: lab report includes the NGS section only when it's been run ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const reportBefore = w.document.getElementById('reportOut').value;
    check('lab report has no NGS section before Step 5′ has been run', !/NGS short-read sequencing/.test(reportBefore));
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const reportAfter = w.document.getElementById('reportOut').value;
    check('lab report includes the NGS section once Step 5′ has been run', /NGS short-read sequencing/.test(reportAfter));
    check('zero console/window errors generating both reports', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 13: save/share v7 round trip (ngsRun/ngsSource/ngsDepth) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    doc.getElementById('ngsDepth').value = '30';
    w.runNGS();
    await new Promise(r => setTimeout(r, 20));
    const state = w.eval('buildStateObject()');
    check('buildStateObject is v8', state.v === 8);
    check('buildStateObject captures ngsRun:true', state.ngsRun === true);
    check('buildStateObject captures the chosen ngsSource/ngsDepth', state.ngsSource === 'product' && state.ngsDepth === '30');

    w.generateShareCode();
    const code = doc.getElementById('shareOut').value;
    check('a save code was generated', code && code.length > 0);

    const boot2 = boot();
    await new Promise(r => setTimeout(r, 60));
    boot2.w.document.getElementById('shareIn').value = code;
    boot2.w.loadShareCode();
    await new Promise(r => setTimeout(r, 40));
    check('zero console/window errors restoring an NGS save code', boot2.errors.length === 0);
    check('restored session has lastNGS populated', !!boot2.w.eval('lastNGS'));
    check('restored session used the saved depth (30x)', boot2.w.document.getElementById('ngsDepth').value === '30');
    const restoredPanel = boot2.w.document.getElementById('ngsCoverageChart').innerHTML;
    check('restored session shows a populated NGS coverage chart', restoredPanel.includes('<svg') && restoredPanel.length > 100);
    dom.window.close(); boot2.dom.window.close();
  }

  // ---- Test 14: legacy v6 code (no ngsRun field) still loads and correctly leaves lastNGS null ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    // Build a legacy-shaped v6 state object by hand (pre-NGS fields only) and encode it the
    // same way encodeState() does, mirroring how every prior version-bump test in this project
    // verifies backward compatibility (test_gibson.js's legacy-v5 check, test_elisa.js's
    // legacy-v4 check, etc.).
    const legacyState = {
      v: 6, target: 'egfp', template: doc.getElementById('template').value,
      fwd: doc.getElementById('fwd').value, rev: doc.getElementById('rev').value,
      tailFwd: null, tailRev: null, atemp: +doc.getElementById('atemp').value,
      digestEnzyme: null, digestEnzyme2: null, vecEnzyme: null, vecEnzyme2: null,
      qpcrRun: false, gibsonAssembled: false, goldenGateAssembled: false, elisaRun: false,
    };
    const code = w.eval(`encodeState(${JSON.stringify(legacyState)})`);
    doc.getElementById('shareIn').value = code;
    w.loadShareCode();
    await new Promise(r => setTimeout(r, 40));
    check('zero console/window errors loading a legacy v6 code with no ngsRun field', errors.length === 0);
    check('legacy v6 code loads without throwing (target restored)', w.eval('TARGET') === 'egfp');
    check('lastNGS correctly stays null for a legacy v6 code', w.eval('lastNGS') === null);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
