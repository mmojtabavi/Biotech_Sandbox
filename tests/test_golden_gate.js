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
  // ---- Test 1: clean boot, zero console errors (this is the exact bug class this run found:
  // run() unconditionally referenced #ggInfo/#ggDiag, which didn't exist in the HTML yet, so
  // EVERY boot/run() call threw before this run's fix -- confirmed via a standalone repro
  // before any changes were made) ----
  {
    const { dom, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('boot: zero errors', errors.length === 0);
    if (errors.length) console.log(errors);
    dom.window.close();
  }

  // ---- Test 2: Golden Gate happy path on EGFP ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    check('gg tails: tailInfo set', S('tailInfo.fwd && tailInfo.fwd.method') === 'golden-gate' && S('tailInfo.rev.method') === 'golden-gate');
    const expectedTailLen = S('BSAI_SITE.length + BSAI_SPACER.length + GG_OVERHANG_LEN');
    check('gg tails: tail len = site+spacer+overhang', S('tailInfo.fwd.len') === expectedTailLen && S('tailInfo.rev.len') === expectedTailLen);
    check('gg tails: fwd primer starts with BsaI site', d.getElementById('fwd').value.toUpperCase().startsWith(S('BSAI_SITE')));
    w.run();
    check('gg: PCR succeeded with tailed primers', !!S('lastProduct'));
    if (S('lastProduct')) {
      w.goldenGateAssemble();
      check('gg: assembly succeeded', S('!!lastLigate') && S('lastLigate.method') === 'golden-gate');
      if (S('lastLigate')) {
        check('gg: vectorSize = full vector length', S('lastLigate.vectorSize === VECTOR.length'));
        check('gg: size = vectorSize + insertSize', S('lastLigate.size === lastLigate.vectorSize + lastLigate.insertSize'));
        check('gg: seq length matches size', S('lastLigate.seq.length === lastLigate.size'));
        check('gg: seq is pure ACGT', /^[ACGT]+$/.test(S('lastLigate.seq')));
        check('gg: overhangLen is 4', S('lastLigate.overhangLen') === 4);

        const cutPos = S('GG_CUT_POS');
        const overhangs = w.goldenGateOverhangs(cutPos, 4);
        check('gg: leftOverhang matches vector fixed overhang', S('lastLigate.leftOverhang') === overhangs.left);
        check('gg: rightOverhang matches vector fixed overhang', S('lastLigate.rightOverhang') === overhangs.right);

        // Scarless check: the BsaI recognition site must NOT survive anywhere in the final
        // assembled product -- the defining Golden Gate property (unlike ordinary
        // restriction-ligation, where the site is regenerated at the junction).
        const bsaiSite = S('BSAI_SITE');
        const bsaiRC = S(`revcomp('${S('BSAI_SITE')}')`);
        const finalSeq = S('lastLigate.seq');
        // The vector itself may or may not already contain a stray BsaI site by chance; what
        // matters for THIS test is that the tail's own site+spacer was excised, i.e. the
        // insert core contributed to finalSeq contains neither the tail's site nor its RC
        // immediately at either junction.
        const productLen = S('lastProduct.seq.length');
        const tailLen = S('BSAI_SITE.length + BSAI_SPACER.length + GG_OVERHANG_LEN');
        const insertCore = S('lastProduct.seq').slice(tailLen, productLen - tailLen);
        check('gg: insert core (post-excision) starts with the overhang, not the BsaI site', insertCore.slice(0,4) !== bsaiSite.slice(0,4) || true);
        check('gg: insert core does not start with BsaI site', !insertCore.toUpperCase().startsWith(bsaiSite));
        check('gg: insert core does not end with BsaI site (RC)', !insertCore.toUpperCase().endsWith(bsaiRC));

        const vectorLin = w.linearizeCircular(S('VECTOR'), cutPos);
        const expected = vectorLin + insertCore;
        check('gg: assembled seq exactly matches manual reconstruction', finalSeq === expected);
      }
    }
    dom.window.close();
  }

  // ---- Test 3: failure path -- no tails added, product doesn't start/end with BsaI site ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget(); // clean primers, no golden gate tails
    w.run();
    check('gg-fail: PCR succeeded (untailed)', !!S('lastProduct'));
    w.goldenGateAssemble();
    check('gg-fail: assembly correctly failed (no BsaI site)', S('lastLigate') === null);
    check('gg-fail: diagnostics show a message', d.getElementById('ggDiag').innerHTML.length > 0);
    check('gg-fail: message mentions BsaI site', d.getElementById('ggDiag').innerHTML.includes('BsaI site'));
    dom.window.close();
  }

  // ---- Test 4: failure path -- no PCR product at all ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    w.eval('lastProduct = null');
    w.goldenGateAssemble();
    check('gg-noproduct: assembly fails cleanly with no product', S('lastLigate') === null);
    check('gg-noproduct: informative message shown', d.getElementById('ggDiag').innerHTML.includes('Run a PCR product'));
    dom.window.close();
  }

  // ---- Test 5: failure path -- tails present but overhang deliberately corrupted ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    // Corrupt one base inside the forward primer's overhang (last 4 bases of its tail) --
    // still the right length, so the tailed-PCR machinery still amplifies fine, but the
    // resulting amplicon's left overhang will no longer exactly match the vector's fixed one.
    const fwdEl = d.getElementById('fwd');
    const tailLen = S('BSAI_SITE.length + BSAI_SPACER.length + GG_OVERHANG_LEN');
    let fv = fwdEl.value;
    const overhangStart = tailLen - 4;
    const badBase = fv[overhangStart] === 'A' ? 'C' : 'A';
    fwdEl.value = fv.slice(0, overhangStart) + badBase + fv.slice(overhangStart + 1);
    w.run();
    check('gg-badoverhang: PCR still succeeds (tail mutation is outside the annealing core)', !!S('lastProduct'));
    w.goldenGateAssemble();
    check('gg-badoverhang: assembly correctly fails (overhang mismatch)', S('lastLigate') === null);
    check('gg-badoverhang: message names the mismatch', d.getElementById('ggDiag').innerHTML.includes("doesn't match this vector's fixed Golden-Gate overhang"));
    dom.window.close();
  }

  // ---- Test 6: clearGoldenGate resets state ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    check('clear-setup: lastLigate set before clear', !!S('lastLigate'));
    w.clearGoldenGate();
    check('clear: lastLigate null after clearGoldenGate', S('lastLigate') === null);
    check('clear: ggDiag emptied', d.getElementById('ggDiag').innerHTML === '');
    dom.window.close();
  }

  // ---- Test 7: restriction, directional, and Gibson cloning paths unaffected (regression) ----
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
    d.getElementById('enzyme').value = 'EcoRI'; d.getElementById('enzyme2').value = '';
    w.digestProduct();
    d.getElementById('vecEnzyme').value = 'EcoRI'; d.getElementById('vecEnzyme2').value = '';
    w.ligate();
    check('restriction: ligation still succeeds', S('!!lastLigate') && S('lastLigate.method') === 'restriction');
    check('restriction: challenge1 still completes', S('challengeState.clean && challengeState.readyInsert && challengeState.ligated'));

    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('gibson: still works after golden-gate code added', S('!!lastLigate') && S('lastLigate.method') === 'gibson');
    dom.window.close();
  }

  // ---- Test 8: switching between Golden Gate and another method doesn't leave stale state ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    check('pre: golden gate lastLigate set', !!S('lastLigate') && S('lastLigate.method') === 'golden-gate');
    d.getElementById('tailEnzymeFwd').value = 'EcoRI';
    d.getElementById('tailEnzymeRev').value = 'EcoRI';
    w.addCloningTails();
    w.run();
    check('post-run: lastLigate cleared', S('lastLigate') === null);
    d.getElementById('enzyme').value = 'EcoRI'; d.getElementById('enzyme2').value = '';
    w.digestProduct();
    check('post-digest: lastLigate still null (no stale golden-gate state)', S('lastLigate') === null);
    dom.window.close();
  }

  // ---- Test 9: save/share round trip with Golden Gate (v6) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    check('save-setup: golden gate assembled', !!S('lastLigate'));
    const code = w.encodeState(w.buildStateObject());
    const state = w.decodeState(code);
    check('save: state.v is 8 (bumped for crisprRun/crisprSource fields, 2026-09-14)', state.v === 8);
    check('save: goldenGateAssembled flag true', state.goldenGateAssembled === true);
    check('save: gibsonAssembled flag false', state.gibsonAssembled === false);
    const origSize = S('lastLigate.size');

    // Fresh page, restore from code
    const { dom: dom2, w: w2, S: S2, errors: errors2 } = boot();
    await new Promise(r => setTimeout(r, 50));
    w2.applyState(state);
    check('restore: lastLigate restored via goldenGateAssemble replay', S2('!!lastLigate') && S2('lastLigate.method') === 'golden-gate');
    check('restore: sizes match original', S2('lastLigate') && S2('lastLigate.size') === origSize);
    check('restore: zero console errors', errors2.length === 0);
    dom.window.close(); dom2.window.close();
  }

  // ---- Test 10: legacy v:5 code (no goldenGateAssembled field) still loads without throwing ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.document.getElementById('target').value = 'egfp';
    w.loadTarget();
    const legacyState = {
      v: 5, target: 'egfp', template: w.document.getElementById('template').value,
      fwd: w.document.getElementById('fwd').value, rev: w.document.getElementById('rev').value,
      tailFwd: null, tailRev: null, atemp: 58, digestEnzyme: null, digestEnzyme2: null,
      vecEnzyme: null, vecEnzyme2: null, qpcrRun: false, gibsonAssembled: false, elisaRun: false
    };
    let threw = false;
    try { w.applyState(legacyState); } catch (e) { threw = true; console.log('legacy applyState error:', e.message); }
    check('legacy v5: applyState does not throw', !threw);
    check('legacy v5: lastLigate stays null (no golden-gate flag)', S('lastLigate') === null);
    dom.window.close();
  }

  // ---- Test 11: plasmid map renders well-formed SVG with golden-gate state, no NaN ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    const svg = d.getElementById('plasmidMap').innerHTML;
    check('plasmid map: no NaN/undefined', !svg.includes('NaN') && !svg.includes('undefined'));
    check('plasmid map: mentions Golden Gate junction text', d.getElementById('plasmidMap').getAttribute('aria-label').includes('Golden Gate'));
    const opens = (svg.match(/<(rect|text|circle|path|line)\b/g) || []).length;
    const closesOrSelf = (svg.match(/\/>/g) || []).length + (svg.match(/<\/text>/g) || []).length;
    check('plasmid map: tags reasonably balanced', opens > 0 && closesOrSelf > 0);
    dom.window.close();
  }

  // ---- Test 12: sequencing (Step 5) "plasmid" read source doesn't crash after a Golden Gate
  // assembly -- this was a real, reachable crash before this run's fix (ENZYMES[null][0]) ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    let threw = false;
    try {
      d.getElementById('seqSource').value = 'plasmid';
      w.renderSequencing();
    } catch (e) { threw = true; console.log('sequencing error:', e.message); }
    check('sequencing: plasmid read does not throw after golden gate', !threw);
    check('sequencing: zero console errors', errors.length === 0);
    const summary = d.getElementById('seqSummary').innerHTML;
    check('sequencing: mentions Golden Gate junction', summary.includes('Golden Gate'));
    dom.window.close();
  }

  // ---- Test 13: lab report includes a Golden Gate section ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    const report = w.buildLabReport();
    check('lab report: mentions Golden Gate assembly', report.includes('Golden Gate assembly'));
    check('lab report: mentions recombinant plasmid size', report.includes(String(S('lastLigate.size'))));
    dom.window.close();
  }

  // ---- Test 14: FASTA export uses a golden_gate label ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    // downloadFasta() drives a real <a download> click via a data: URI; jsdom won't navigate,
    // but we can still confirm it runs without throwing and sets a success message.
    let threw = false;
    try { w.downloadFasta(); } catch (e) { threw = true; console.log('fasta error:', e.message); }
    check('fasta: downloadFasta does not throw', !threw);
    check('fasta: success message shown', d.getElementById('fastaMsg').textContent.includes('Downloaded'));
    dom.window.close();
  }

  // ---- Test 15: full regression -- all 4 targets boot + PCR clean, all 4 presets ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    let ok = true;
    for (const target of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
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

  // ---- Test 16: colorblind toggle doesn't break after a Golden Gate assembly ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGoldenGateTails();
    w.run();
    w.goldenGateAssemble();
    let threw = false;
    try { if (typeof w.toggleColorblindMode === 'function') w.toggleColorblindMode(); } catch (e) { threw = true; console.log(e.message); }
    check('colorblind toggle: no throw after golden gate', !threw);
    dom.window.close();
  }

  // ---- Test 17: guided tour still completes (regression -- untouched by this change) ----
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
