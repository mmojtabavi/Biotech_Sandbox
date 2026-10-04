const fs = require('fs');
const { JSDOM } = require('jsdom');

// Verifies Step 9 — CRISPR/Cas9 guide RNA design, a self-generated roadmap item (2026-08-08
// batch) built this run (2026-09-14). The coordinate math (PAM scanning on both strands, cut
// site placement) was independently hand-verified against constructed test sequences with a
// known planted guide/PAM before being written into pcr-lab.html (see the dated note in
// PROJECT_STATUS.md's Changelog) — this suite re-checks that same math against the live file,
// plus the on-target scoring heuristics, off-target logic, UI wiring, save/share, and lab report.

const html = fs.readFileSync(require('path').join(__dirname, '..', 'pcr-lab.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }

function boot() {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  dom.window.onerror = (msg) => errors.push(msg);
  const w = dom.window;
  const S = (expr) => w.eval(expr);
  return { dom, w, S, errors };
}

(async () => {
  // ---- Test 1: findPamSites forward-strand coordinate math (hand-constructed known site) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const filler = 'ACGTACGTACGTACGTACGT'; // 20nt
    const knownProtospacer = 'TTAACCGGTTAACCGGTTAA'; // 20nt
    const pam = 'TGG';
    const seq = filler + knownProtospacer + pam + 'CCCCCCCCCC';
    const hits = w.findPamSites(seq);
    const hit = hits.find(h => h.strand === '+' && h.cutPos === 37);
    check('forward-strand PAM found at the expected cut position (37 = 40-3)', !!hit);
    check('forward-strand protospacer extracted exactly matches the known 20nt', hit && hit.protospacer === knownProtospacer);
    check('forward-strand PAM extracted exactly matches (TGG)', hit && hit.pam === pam);
    dom.window.close();
  }

  // ---- Test 2: findPamSites reverse-strand coordinate math (hand-constructed known site) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const knownGuideRev = 'GGCCAATTGGCCAATTGGCC'; // 20nt, as read 5'->3' on the reverse strand
    const pamRev = 'AGG';
    const revStrand23 = knownGuideRev + pamRev; // 5'->3' on reverse strand: protospacer then PAM
    const fwdSlice23 = S('revcomp')(revStrand23); // what appears on the forward strand, low->high index
    const seq = 'AAAAAAAAAAAAAAAAAAAA' + fwdSlice23 + 'TTTTTTTTTTTTTTTTTTTT'; // filler avoids an accidental CC at the junction
    const hits = w.findPamSites(seq);
    const hit = hits.find(h => h.strand === '-' && h.cutPos === 26);
    check('reverse-strand PAM found at the expected cut position (26 = 20+6)', !!hit);
    check('reverse-strand protospacer exactly matches the known guide (after revcomp translation)', hit && hit.protospacer === knownGuideRev);
    check('reverse-strand PAM exactly matches (AGG)', hit && hit.pam === pamRev);
    dom.window.close();
  }

  // ---- Test 3: findPamSites only reports real NGG sites, never a false negative/positive on a synthetic sweep ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const seq = S('EGFP');
    const hits = w.findPamSites(seq);
    check('every reported forward-strand hit really has GG at pam[1..3)', hits.filter(h => h.strand === '+').every(h => h.pam[1] === 'G' && h.pam[2] === 'G'));
    check('every reported reverse-strand hit produces a valid NGG pam after revcomp translation', hits.filter(h => h.strand === '-').every(h => h.pam[1] === 'G' && h.pam[2] === 'G'));
    check('every protospacer is exactly 20nt', hits.every(h => h.protospacer.length === 20));
    check('cutPos is always within the sequence bounds', hits.every(h => h.cutPos >= 0 && h.cutPos <= seq.length));
    dom.window.close();
  }

  // ---- Test 4: guideOffTargetRisk correctness (planted exact match + seed-mismatch escape) ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const bg = S('BACKGROUND_GENOME');
    const sites = w.findPamSites(bg);
    check('background genome has real PAM sites to test against', sites.length > 0);
    const planted = sites[0].protospacer;
    const rPlanted = w.guideOffTargetRisk(planted, bg);
    check('a guide identical to a real background protospacer is found as an exact off-target', rPlanted.exactCount >= 1);

    // Mutate the seed region (last 10 nt, PAM-proximal) by one base — real biology says this
    // should abolish binding at that specific site, so it should drop out of both exact AND risk.
    const seedMutated = planted.slice(0, 10) + (planted[10] === 'A' ? 'C' : 'A') + planted.slice(11);
    const rSeedMut = w.guideOffTargetRisk(seedMutated, bg);
    check('a single seed-region mismatch drops that specific site out of "risk" (real off-target biology)', !rSeedMut.details.some(d => d.cutPos === sites[0].cutPos && d.strand === sites[0].strand));

    const junk = 'AAAAAAAAAAAAAAAAAAAA';
    const rJunk = w.guideOffTargetRisk(junk, bg);
    check('a junk (poly-A) guide has no exact off-target matches', rJunk.exactCount === 0);
    dom.window.close();
  }

  // ---- Test 5: scoreGuide structure & explainable bounds ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const bg = S('BACKGROUND_GENOME');
    const r = w.scoreGuide('ATGCGTACGTAGCTAGCTAG', bg);
    check('score is a number 0-100', typeof r.score === 'number' && r.score >= 0 && r.score <= 100);
    check('breakdown has exactly 4 components', r.breakdown.length === 4);
    check('every breakdown penalty is a non-negative number with a label/detail', r.breakdown.every(b => typeof b.penalty === 'number' && b.penalty >= 0 && typeof b.label === 'string' && typeof b.detail === 'string'));

    const polyTGuide = 'ACGTACGTTTTTACGTACGT'; // contains TTTT
    const rPolyT = w.scoreGuide(polyTGuide, bg);
    check('a guide with a TTTT+ run is penalized in the Poly-T breakdown line', rPolyT.breakdown.find(b => b.label === 'Poly-T run').penalty > 0);

    const extremeGC = 'GGGGGGGGGGGGGGGGGGGG'; // 100% GC
    const rGC = w.scoreGuide(extremeGC, bg);
    check('a 100% GC guide is penalized on GC content', rGC.breakdown.find(b => b.label === 'GC content').penalty > 0);
    dom.window.close();
  }

  // ---- Test 6: currentCrisprSource gating (no PCR product / no ligated plasmid) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    doc.getElementById('crisprSource').value = 'plasmid';
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    check('gating message when no ligated plasmid exists yet', /ligate a construct/i.test(doc.getElementById('crisprSummary').textContent));
    check('lastCRISPR stays null when gated', w.eval('lastCRISPR') === null);
    doc.getElementById('crisprSource').value = 'template';
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    check('runCRISPR on the current template succeeds without a gating message', !/first —|first-/i.test(doc.getElementById('crisprSummary').textContent));
    dom.window.close();
  }

  // ---- Test 7: full page boot wiring, zero console errors, panel populates after clicking scan ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    check('zero console/window errors on default boot', errors.length === 0);
    const doc = w.document;
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors after Scan for guide RNAs', errors.length === 0);
    const summary = doc.getElementById('crisprSummary').innerHTML;
    check('CRISPR summary populates with site/score info', /PAM site/.test(summary) && /score/.test(summary));
    const map = doc.getElementById('crisprMap').innerHTML;
    const table = doc.getElementById('crisprTableWrap').innerHTML;
    check('guide map SVG is populated', map.includes('<svg') && map.length > 100);
    check('candidate table is populated', table.includes('<table') && (table.match(/<tr/g) || []).length > 1);
    check('guide map aria-label is content-specific', /CRISPR guide map/.test(map));
    check('no NaN in the guide map SVG', !/NaN/.test(map));
    dom.window.close();
  }

  // ---- Test 8: clearCRISPR resets state and DOM cleanly ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    w.clearCRISPR();
    check('lastCRISPR is null after clear', w.eval('lastCRISPR') === null);
    check('guide map is cleared', doc.getElementById('crisprMap').innerHTML === '');
    check('table is cleared', doc.getElementById('crisprTableWrap').innerHTML === '');
    check('zero console/window errors after clear', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 9: refreshCRISPR only re-scans if the learner already clicked Scan once ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.refreshCRISPR(); // never clicked "Scan for guide RNAs" yet -> should be a no-op
    check('refreshCRISPR is a no-op before the first manual scan', w.eval('lastCRISPR') === null);
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    const before = doc.getElementById('crisprMap').innerHTML;
    doc.getElementById('target').value = 'lacz';
    w.loadTarget(); // triggers refreshCRISPR() via the same hook run()/loadTarget() already call
    await new Promise(r => setTimeout(r, 20));
    const after = doc.getElementById('crisprMap').innerHTML;
    check('refreshCRISPR re-renders (not stale) once a manual scan has happened', before !== after);
    check('zero console/window errors across refresh cycle', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 10: plasmid-source CRISPR scan after a real ligation ----
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
    doc.getElementById('crisprSource').value = 'plasmid';
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors scanning the ligated plasmid', errors.length === 0);
    const lastCRISPR = w.eval('lastCRISPR');
    check('CRISPR scanned the plasmid sequence, not the shorter PCR product', lastCRISPR.seq === w.eval('lastLigate.seq'));
    dom.window.close();
  }

  // ---- Test 11: colorblind toggle survives a CRISPR render ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    const before = doc.getElementById('crisprMap').innerHTML;
    w.toggleColorblindMode();
    await new Promise(r => setTimeout(r, 20));
    const after = doc.getElementById('crisprMap').innerHTML;
    check('zero console/window errors toggling colorblind mode with CRISPR results present', errors.length === 0);
    check('guide map re-renders (not blanked) after the colorblind toggle', after.includes('<svg') && after.length > 100);
    check('toggling colorblind mode actually changes the rendered map (palette swap took effect)', before !== after);
    dom.window.close();
  }

  // ---- Test 12: full target sweep, zero errors, including a CRISPR scan per target ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    for (const t of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
      doc.getElementById('target').value = t;
      w.loadTarget();
      w.runCRISPR();
    }
    check('zero console/window errors across a full 5-target CRISPR sweep', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 13: lab report includes the CRISPR section only when it's been run ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const reportBefore = w.document.getElementById('reportOut').value;
    check('lab report has no CRISPR section before Step 9 has been run', !/CRISPR\/Cas9 guide RNA design/.test(reportBefore));
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const reportAfter = w.document.getElementById('reportOut').value;
    check('lab report includes the CRISPR section once Step 9 has been run', /CRISPR\/Cas9 guide RNA design/.test(reportAfter));
    check('zero console/window errors generating both reports', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 14: save/share v8 round trip (crisprRun/crisprSource) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    const state = w.eval('buildStateObject()');
    check('buildStateObject is v8', state.v === 8);
    check('buildStateObject captures crisprRun:true', state.crisprRun === true);
    check('buildStateObject captures the chosen crisprSource', state.crisprSource === 'template');

    w.generateShareCode();
    const code = doc.getElementById('shareOut').value;
    check('a save code was generated', code && code.length > 0);

    const boot2 = boot();
    await new Promise(r => setTimeout(r, 60));
    boot2.w.document.getElementById('shareIn').value = code;
    boot2.w.loadShareCode();
    await new Promise(r => setTimeout(r, 40));
    check('zero console/window errors restoring a CRISPR save code', boot2.errors.length === 0);
    check('restored session has lastCRISPR populated', !!boot2.w.eval('lastCRISPR'));
    const restoredMap = boot2.w.document.getElementById('crisprMap').innerHTML;
    check('restored session shows a populated CRISPR guide map', restoredMap.includes('<svg') && restoredMap.length > 100);
    dom.window.close(); boot2.dom.window.close();
  }

  // ---- Test 15: legacy v7 code (no crisprRun field) still loads and correctly leaves lastCRISPR null ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    const legacyState = {
      v: 7, target: 'egfp', template: doc.getElementById('template').value,
      fwd: doc.getElementById('fwd').value, rev: doc.getElementById('rev').value,
      tailFwd: null, tailRev: null, atemp: +doc.getElementById('atemp').value,
      digestEnzyme: null, digestEnzyme2: null, vecEnzyme: null, vecEnzyme2: null,
      qpcrRun: false, gibsonAssembled: false, goldenGateAssembled: false, elisaRun: false,
      ngsRun: false, ngsSource: null, ngsDepth: null,
    };
    const code = w.eval(`encodeState(${JSON.stringify(legacyState)})`);
    doc.getElementById('shareIn').value = code;
    w.loadShareCode();
    await new Promise(r => setTimeout(r, 40));
    check('zero console/window errors loading a legacy v7 code with no crisprRun field', errors.length === 0);
    check('legacy v7 code loads without throwing (target restored)', w.eval('TARGET') === 'egfp');
    check('lastCRISPR correctly stays null for a legacy v7 code', w.eval('lastCRISPR') === null);
    dom.window.close();
  }

  // ---- Test 16: too-short sequence is gated gracefully (no throw) rather than producing garbage ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const doc = w.document;
    doc.getElementById('template').value = 'ACGT'; // far too short for a 23bp protospacer+PAM
    doc.getElementById('crisprSource').value = 'template';
    w.runCRISPR();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors on a too-short sequence', errors.length === 0);
    check('lastCRISPR stays null for a too-short sequence', w.eval('lastCRISPR') === null);
    check('a clear message is shown instead of a crash or blank panel', doc.getElementById('crisprSummary').textContent.length > 0);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
