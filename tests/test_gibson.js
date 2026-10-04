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
  const S = (expr) => w.eval(expr); // read a let/const top-level binding (not attached to window)
  return { dom, w, S, errors };
}

(async () => {
  // ---- Test 1: clean boot, zero console errors ----
  {
    const { dom, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('boot: zero errors', errors.length === 0);
    if (errors.length) console.log(errors);
    dom.window.close();
  }

  // ---- Test 2: Gibson happy path on EGFP ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    check('gibson tails: tailInfo set', S('tailInfo.fwd && tailInfo.fwd.method') === 'gibson' && S('tailInfo.rev.method') === 'gibson');
    check('gibson tails: len 20', S('tailInfo.fwd.len') === 20 && S('tailInfo.rev.len') === 20);
    w.run();
    check('gibson: PCR succeeded with tailed primers', !!S('lastProduct'));
    if (S('lastProduct')) {
      w.gibsonAssemble();
      check('gibson: assembly succeeded', S('!!lastLigate') && S('lastLigate.method') === 'gibson');
      if (S('lastLigate')) {
        check('gibson: vectorSize = full vector length', S('lastLigate.vectorSize === VECTOR.length'));
        check('gibson: size = vectorSize + insertSize', S('lastLigate.size === lastLigate.vectorSize + lastLigate.insertSize'));
        check('gibson: seq length matches size', S('lastLigate.seq.length === lastLigate.size'));
        check('gibson: seq is pure ACGT', /^[ACGT]+$/.test(S('lastLigate.seq')));
        check('gibson: overlapLen is 20', S('lastLigate.overlapLen') === 20);
        const fwdTm = S('lastLigate.overlapTmFwd');
        check('gibson: overlap Tms are plausible (30-80C)', fwdTm > 30 && fwdTm < 80);

        const cutPos = S('MCS_POS.EcoRI');
        const arms = w.gibsonHomologyArms(cutPos, 20);
        check('gibson: assembled seq starts with right arm', S('lastLigate.seq').slice(0, 20) === arms.right);
        const vectorLen = S('VECTOR.length');
        check('gibson: left arm sits at end of vector portion', S('lastLigate.seq').slice(vectorLen - 20, vectorLen) === arms.left);
        const productLen = S('lastProduct.seq.length');
        check('gibson: no duplicated homology (length check)', S('lastLigate.seq.length') === vectorLen + (productLen - 40));

        const insertCore = S('lastProduct.seq').slice(20, productLen - 20);
        const vectorLin = w.linearizeCircular(S('VECTOR'), cutPos);
        const expected = vectorLin + insertCore;
        check('gibson: assembled seq exactly matches manual reconstruction', S('lastLigate.seq') === expected);
      }
    }
    dom.window.close();
  }

  // ---- Test 3: Gibson failure path -- no tails added, product doesn't match homology arms ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget(); // clean primers, no gibson tails
    w.run();
    check('gibson-fail: PCR succeeded (untailed)', !!S('lastProduct'));
    w.gibsonAssemble();
    check('gibson-fail: assembly correctly failed (no matching arms)', S('lastLigate') === null);
    check('gibson-fail: diagnostics show a message', d.getElementById('gibsonDiag').innerHTML.length > 0);
    dom.window.close();
  }

  // ---- Test 4: Gibson failure path -- no PCR product at all ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    w.eval('lastProduct = null');
    w.gibsonAssemble();
    check('gibson-nofail: assembly fails cleanly with no product', S('lastLigate') === null);
    check('gibson-nofail: informative message shown', d.getElementById('gibsonDiag').innerHTML.includes('Run a PCR product'));
    dom.window.close();
  }

  // ---- Test 5: clearGibson resets state ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('clear-setup: lastLigate set before clear', !!S('lastLigate'));
    w.clearGibson();
    check('clear: lastLigate null after clearGibson', S('lastLigate') === null);
    check('clear: gibsonDiag emptied', d.getElementById('gibsonDiag').innerHTML === '');
    dom.window.close();
  }

  // ---- Test 6: restriction-cloning path unaffected (regression) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    d.getElementById('tailEnzymeFwd').value = 'EcoRI';
    d.getElementById('tailEnzymeRev').value = 'EcoRI';
    w.addCloningTails();
    w.run();
    check('restriction: PCR succeeded', !!S('lastProduct'));
    d.getElementById('enzyme').value = 'EcoRI';
    d.getElementById('enzyme2').value = '';
    w.digestProduct();
    check('restriction: digest ready', S('challengeState.readyInsert') === true);
    d.getElementById('vecEnzyme').value = 'EcoRI';
    d.getElementById('vecEnzyme2').value = '';
    w.ligate();
    check('restriction: ligation succeeded', S('!!lastLigate') && S('lastLigate.method') === 'restriction');
    check('restriction: challenge1 complete', S('challengeState.clean && challengeState.readyInsert && challengeState.ligated'));
    dom.window.close();
  }

  // ---- Test 7: directional (two-enzyme) cloning path unaffected (regression) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    d.getElementById('tailEnzymeFwd').value = 'EcoRI';
    d.getElementById('tailEnzymeRev').value = 'BamHI';
    w.addCloningTails();
    w.run();
    d.getElementById('enzyme').value = 'EcoRI';
    d.getElementById('enzyme2').value = 'BamHI';
    w.digestProduct();
    d.getElementById('vecEnzyme').value = 'EcoRI';
    d.getElementById('vecEnzyme2').value = 'BamHI';
    w.ligate();
    check('directional: ligation succeeded', S('!!lastLigate') && S('lastLigate.method') === 'restriction' && S('lastLigate.enzyme2') === 'BamHI');
    dom.window.close();
  }

  // ---- Test 8: save/share round trip with Gibson ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('save-setup: gibson assembled', !!S('lastLigate'));
    const code = w.encodeState(w.buildStateObject());
    const state = w.decodeState(code);
    check('save: state.v is 8 (bumped for crisprRun/crisprSource fields, 2026-09-14)', state.v === 8);
    check('save: gibsonAssembled flag true', state.gibsonAssembled === true);
    const origSize = S('lastLigate.size');

    // Fresh page, restore from code
    const { dom: dom2, w: w2, S: S2, errors: errors2 } = boot();
    await new Promise(r => setTimeout(r, 50));
    w2.applyState(state);
    check('restore: lastLigate restored via gibsonAssemble replay', S2('!!lastLigate') && S2('lastLigate.method') === 'gibson');
    check('restore: sizes match original', S2('lastLigate') && S2('lastLigate.size') === origSize);
    check('restore: zero console errors', errors2.length === 0);
    dom.window.close(); dom2.window.close();
  }

  // ---- Test 9: legacy v:3 code (no gibsonAssembled field) still loads without throwing ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.document.getElementById('target').value = 'egfp';
    w.loadTarget();
    const legacyState = {
      v: 3, target: 'egfp', template: w.document.getElementById('template').value,
      fwd: w.document.getElementById('fwd').value, rev: w.document.getElementById('rev').value,
      tailFwd: null, tailRev: null, atemp: 58, digestEnzyme: null, digestEnzyme2: null,
      vecEnzyme: null, vecEnzyme2: null, qpcrRun: false
    };
    let threw = false;
    try { w.applyState(legacyState); } catch (e) { threw = true; console.log('legacy applyState error:', e.message); }
    check('legacy v3: applyState does not throw', !threw);
    check('legacy v3: lastLigate stays null (no gibson flag)', S('lastLigate') === null);
    dom.window.close();
  }

  // ---- Test 10: plasmid map renders well-formed SVG with gibson state, no NaN ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    const svg = d.getElementById('plasmidMap').innerHTML;
    check('plasmid map: no NaN/undefined', !svg.includes('NaN') && !svg.includes('undefined'));
    check('plasmid map: mentions Gibson junction text present', d.getElementById('plasmidMap').getAttribute('aria-label').includes('Gibson'));
    const opens = (svg.match(/<(rect|text|circle|path|line)\b/g) || []).length;
    const closesOrSelf = (svg.match(/\/>/g) || []).length + (svg.match(/<\/text>/g) || []).length;
    check('plasmid map: tags reasonably balanced', opens > 0 && closesOrSelf > 0);
    dom.window.close();
  }

  // ---- Test 11: lastLigate is null-safe in digestProduct after a prior gibson assembly ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('pre: gibson lastLigate set', !!S('lastLigate'));
    d.getElementById('tailEnzymeFwd').value = 'EcoRI';
    d.getElementById('tailEnzymeRev').value = 'EcoRI';
    w.addCloningTails();
    w.run();
    check('post-run: lastLigate cleared', S('lastLigate') === null);
    d.getElementById('enzyme').value = 'EcoRI'; d.getElementById('enzyme2').value = '';
    w.digestProduct();
    check('post-digest: lastLigate still null (no stale gibson state)', S('lastLigate') === null);
    dom.window.close();
  }

  // ---- Test 12: circSlice wraps correctly around origin ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const seq = 'ACGTACGTAC'; // len 10
    check('circSlice: no-wrap slice', w.circSlice(seq, 2, 3) === 'GTA');
    check('circSlice: wrap-around slice', w.circSlice(seq, 8, 4) === 'ACAC');
    check('circSlice: negative start wraps', w.circSlice(seq, -2, 3) === 'ACA');
    dom.window.close();
  }

  // ---- Test 13: full existing regression -- all 4 targets boot + PCR clean, all 4 presets ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    let ok = true;
    for (const target of ['egfp', 'lacz', 'ubq', 'practice']) {
      d.getElementById('target').value = target;
      w.loadTarget();
      if (!S('lastProduct')) ok = false;
      for (const preset of ['clean', 'mm3', 'lowtm', 'nonspec']) {
        try { w.loadPreset(preset); } catch (e) { ok = false; console.log('preset error', target, preset, e.message); }
      }
    }
    check('regression: all targets/presets run without throw', ok);
    check('regression: zero console errors after full sweep', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 14: colorblind toggle doesn't break after a Gibson assembly ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    let threw = false;
    try { if (typeof w.toggleColorblindMode === 'function') w.toggleColorblindMode(); } catch (e) { threw = true; console.log(e.message); }
    check('colorblind toggle: no throw after gibson', !threw);
    dom.window.close();
  }

  // ---- Test 15: guided tour still completes (regression -- untouched by this change) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    let threw = false;
    try {
      if (typeof w.startTour === 'function') {
        w.startTour();
        for (let i = 0; i < 13; i++) { if (typeof w.tourNext === 'function') w.tourNext(); }
      }
    } catch (e) { threw = true; console.log('tour error', e.message); }
    check('tour: completes without throw', !threw);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
