// jsdom-driven logic tests for the Step 8 ELISA engine + UI wiring, mirroring the existing
// test_hplc.js/test_gibson.js pattern in this project (real DOM boot via window.eval, not a
// hand-rolled vm sandbox, since top-level const/let in the page's <script> aren't own-properties
// of window but ARE visible to window.eval()).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'pcr-lab.html'), 'utf8');

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
  // ---- Test 1: langmuirSignal basic behavior ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('signal at conc=0 is exactly 0', w.langmuirSignal(0, 10) === 0);
    check('signal at conc=Kd is exactly half of Bmax', Math.abs(w.langmuirSignal(10, 10, 1) - 0.5) < 1e-9);
    check('signal approaches Bmax at very high concentration', w.langmuirSignal(1e9, 10, 1) > 0.999999);
    check('signal is monotonically increasing in concentration', w.langmuirSignal(5, 10) < w.langmuirSignal(50, 10) && w.langmuirSignal(50, 10) < w.langmuirSignal(500, 10));
    check('signal scales with bmax', Math.abs(w.langmuirSignal(10, 10, 2) - 1.0) < 1e-9);
    check('zero console errors on boot', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 2: ELISA_DILUTIONS / ELISA_KD_NM tables ----
  // (declared with const in the page script, so they aren't own-properties of window — same
  // reason test_hplc.js reads KD_HYDROPATHY via S('KD_HYDROPATHY') rather than w.KD_HYDROPATHY)
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const dil = S('ELISA_DILUTIONS');
    check('8 dilution points', dil.length === 8);
    check('dilutions strictly decreasing', dil.every((v, i) => i === 0 || v < dil[i - 1]));
    check('first dilution point is 1000 nM', Math.abs(dil[0] - 1000) < 1e-9);
    check('each step is a sqrt(10)-fold dilution', Math.abs(dil[0] / dil[1] - Math.sqrt(10)) < 1e-6);
    const kd = S('ELISA_KD_NM');
    check('egfp/lacz/ubq all have a synthetic Kd', ['egfp', 'lacz', 'ubq'].every(k => typeof kd[k] === 'number' && kd[k] > 0));
    check('practice target has NO Kd entry (no real antibody exists)', kd['practice'] === undefined);
    check('EGFP is the tightest (lowest Kd) of the three targets', kd.egfp < kd.lacz && kd.lacz < kd.ubq);
    dom.window.close();
  }

  // ---- Test 3: simulateElisa + double-reciprocal back-fit recovers the true Kd/Bmax ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const bmaxTrue = S('ELISA_BMAX');
    for (const [label, kdVal] of [['tight (EGFP-like)', 2], ['mid (lacZ-like)', 35], ['weak (Ubq-like)', 180]]) {
      const res = w.simulateElisa(kdVal);
      check(`${label}: returns 8 points`, res.points.length === 8);
      check(`${label}: all signals in (0,1]`, res.points.every(p => p.signal > 0 && p.signal <= 1));
      check(`${label}: signal decreases as the dilution series proceeds (concentration falls)`, res.points.every((p, i) => i === 0 || p.signal <= res.points[i - 1].signal));
      check(`${label}: fit exists`, !!res.fit);
      if (res.fit) {
        check(`${label}: back-calculated Kd matches simulated Kd to within 0.5%`, Math.abs(res.fit.kdCalc - kdVal) / kdVal < 0.005);
        check(`${label}: back-calculated Bmax matches simulated Bmax (1.0) to within 0.5%`, Math.abs(res.fit.bmaxCalc - bmaxTrue) < 0.005);
        check(`${label}: fit R^2 is essentially 1 (noise-free simulation)`, res.fit.r2 > 0.9999);
      }
    }
    const a = w.simulateElisa(10), b = w.simulateElisa(10);
    check('simulateElisa is deterministic (same Kd -> identical points)', JSON.stringify(a.points) === JSON.stringify(b.points));
    dom.window.close();
  }

  // ---- Test 4: full-page boot wiring — default target (EGFP) gets a usable ELISA gate ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('zero console errors on default boot', errors.length === 0);
    check('elisaBtn NOT disabled for EGFP (default target)', S("document.getElementById('elisaBtn').disabled") === false);
    check('lastElisa is null before Run is clicked', S('lastElisa') === null);
    check('elisaSummary shows the pre-run prompt', S("document.getElementById('elisaSummary').textContent").includes('Run ELISA'));
    dom.window.close();
  }

  // ---- Test 5: clicking Run ELISA on a real target renders both charts + non-empty diagnostics ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.runElisa();
    check('lastElisa populated after runElisa()', S('lastElisa') !== null);
    check('bind chart has SVG content', S("document.getElementById('elisaBindChart').innerHTML.length") > 100);
    check('double-reciprocal chart has SVG content', S("document.getElementById('elisaLbChart').innerHTML.length") > 100);
    check('no NaN in bind chart markup', !S("document.getElementById('elisaBindChart').innerHTML").includes('NaN'));
    check('no NaN in double-reciprocal chart markup', !S("document.getElementById('elisaLbChart').innerHTML").includes('NaN'));
    check('diag list has 8 entries', S("document.getElementById('elisaDiag').children.length") === 8);
    check('summary mentions back-calculated Kd', S("document.getElementById('elisaSummary').innerHTML").includes('K<sub>d</sub> ='));
    check('bind chart aria-label is content-specific (mentions target)', S("document.getElementById('elisaBindChart').getAttribute('aria-label')").includes('EGFP'));
    check('zero console errors after running ELISA', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 6: practice target gates ELISA off with a clear message, button disabled ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    S("document.getElementById('target').value='practice'");
    w.loadTarget();
    check('elisaBtn IS disabled for practice target', S("document.getElementById('elisaBtn').disabled") === true);
    check('lastElisa stays null for practice target', S('lastElisa') === null);
    check('gating message explains why (mentions antibody)', S("document.getElementById('elisaSummary').innerHTML").toLowerCase().includes('antibody'));
    check('charts are empty for practice target', S("document.getElementById('elisaBindChart').innerHTML") === '');
    check('zero console errors', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 7: switching target after a run clears the stale result (Kd is target-specific) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    S("document.getElementById('target').value='egfp'"); w.loadTarget();
    w.runElisa();
    const egfpKd = S('lastElisa.kdNm');
    check('EGFP run recorded the EGFP Kd', egfpKd === 2);
    S("document.getElementById('target').value='ubq'");
    w.loadTarget();
    check('switching target clears the previous ELISA run (Kd is target-specific)', S('lastElisa') === null);
    check('elisaBtn re-enabled for the new real target (Ubiquitin)', S("document.getElementById('elisaBtn').disabled") === false);
    dom.window.close();
  }

  // ---- Test 8: colorblind toggle re-renders an already-run ELISA without dropping it ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.runElisa();
    const before = S('lastElisa.kdNm');
    w.toggleColorblindMode();
    check('lastElisa survives a colorblind-palette toggle', S('lastElisa.kdNm') === before);
    check('bind chart still has content after toggle', S("document.getElementById('elisaBindChart').innerHTML.length") > 100);
    dom.window.close();
  }

  // ---- Test 9: save/share round trip — elisaRun flag persists and replays correctly ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.runElisa();
    check('buildStateObject is v8 (bumped for crisprRun flag) and carries elisaRun:true', S('buildStateObject().v') === 8 && S('buildStateObject().elisaRun') === true);
    const code = w.generateShareCode();
    dom.window.close();

    const { dom: dom2, w: w2, S: S2 } = boot();
    await new Promise(r => setTimeout(r, 50));
    S2(`document.getElementById('shareIn').value=${JSON.stringify(code)}`);
    w2.loadShareCode();
    check('restored session has lastElisa populated (Step 8 replayed live)', S2('lastElisa') !== null);
    check('restored elisaBindChart is rendered', S2("document.getElementById('elisaBindChart').innerHTML.length") > 100);
    dom2.window.close();
  }
  {
    // legacy v4 code (no elisaRun field) must still load without throwing and leave lastElisa null
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const legacy = { v: 4, target: 'egfp', template: S('TEMPLATE'), fwd: S("document.getElementById('fwd').value"), rev: S("document.getElementById('rev').value"), tailFwd: null, tailRev: null, atemp: 58, digestEnzyme: null, digestEnzyme2: null, vecEnzyme: null, vecEnzyme2: null, qpcrRun: false, gibsonAssembled: false };
    const code = w.encodeState(legacy);
    S(`document.getElementById('shareIn').value=${JSON.stringify(code)}`);
    let threw = false;
    try { w.loadShareCode(); } catch (e) { threw = true; }
    check('legacy v4 code (no elisaRun) loads without throwing', !threw);
    check('legacy v4 code correctly leaves lastElisa null', S('lastElisa') === null);
    dom.window.close();
  }

  // ---- Test 10: lab report includes a Step 8 section reflecting the current target ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const report = w.buildLabReport();
    check('lab report includes Step 8 ELISA section', report.includes('Step 8 - ELISA'));
    check('lab report shows the EGFP synthetic Kd (2 nM)', report.includes('2 nM'));
    S("document.getElementById('target').value='practice'"); w.loadTarget();
    const report2 = w.buildLabReport();
    check('lab report correctly notes ELISA unavailable for practice target', report2.includes('Not available for the practice template'));
    dom.window.close();
  }

  // ---- Test 11: full 4-target sweep — no throws, no NaN, correct gating for all targets ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    for (const t of ['egfp', 'lacz', 'ubq', 'practice']) {
      S(`document.getElementById('target').value='${t}'`);
      w.loadTarget();
      const hasKd = t !== 'practice';
      check(`${t}: elisaBtn disabled state matches Kd availability`, S("document.getElementById('elisaBtn').disabled") === !hasKd);
      if (hasKd) {
        w.runElisa();
        check(`${t}: runElisa produces a result`, S('lastElisa') !== null);
        check(`${t}: no NaN in bind chart`, !S("document.getElementById('elisaBindChart').innerHTML").includes('NaN'));
        check(`${t}: no NaN in reciprocal chart`, !S("document.getElementById('elisaLbChart').innerHTML").includes('NaN'));
      }
    }
    check('zero console errors across full target sweep', errors.length === 0);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
