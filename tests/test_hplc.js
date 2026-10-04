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
  // ---- Test 1: KD_HYDROPATHY table completeness and known values ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const table = S('KD_HYDROPATHY');
    const aas = ['A','R','N','D','C','Q','E','G','H','I','L','K','M','F','P','S','T','W','Y','V'];
    check('KD table has all 20 standard amino acids', aas.every(a => typeof table[a] === 'number'));
    check('Isoleucine is the most hydrophobic (4.5)', table.I === 4.5);
    check('Arginine is the most hydrophilic (-4.5)', table.R === -4.5);
    check('Glycine matches published value (-0.4)', table.G === -0.4);
    dom.window.close();
  }

  // ---- Test 2: gravy() basic correctness ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('gravy of empty string is 0', w.gravy('') === 0);
    check('gravy of single Ile = 4.5', w.gravy('I') === 4.5);
    check('gravy of III = 4.5 (all same)', w.gravy('III') === 4.5);
    // hand-computed: I(4.5) + R(-4.5) average to 0
    check('gravy of IR = 0 (exact cancellation)', w.gravy('IR') === 0);
    // unknown residue (X, stop-codon translation artifact) should be skipped, not crash or corrupt mean
    check('gravy skips unknown residues gracefully', w.gravy('IX') === 4.5);
    dom.window.close();
  }

  // ---- Test 3: hydropathyProfile() shape and windowing ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const protein = 'MAAAAAAAAARRRRRRRRRR'; // 1 M + 10 A (hydrophobic-ish) + 10 R (very hydrophilic)
    const profile = w.hydropathyProfile(protein, 9);
    check('profile length matches protein length', profile.length === protein.length);
    check('profile is all finite numbers', profile.every(v => typeof v === 'number' && isFinite(v)));
    // early positions (within the Ala run) should be higher (more hydrophobic) than late positions (within the Arg run)
    check('profile trends from hydrophobic to hydrophilic across the sequence', profile[2] > profile[protein.length - 3]);
    check('empty protein returns empty profile', w.hydropathyProfile('', 9).length === 0);
    dom.window.close();
  }

  // ---- Test 4: estimateHplcRetention() correctness and clamping ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const VOID = S('HPLC_GRADIENT_VOID'), END = S('HPLC_GRADIENT_END'), HI = S('HPLC_GRAVY_HI');
    check('null for empty protein', w.estimateHplcRetention('') === null);
    check('null for undefined protein', w.estimateHplcRetention(undefined) === null);

    // A perfectly neutral GRAVY of 0 should land exactly halfway across the modeled gradient.
    const mid = w.estimateHplcRetention('IR'); // gravy=0 exactly
    const expectedMid = VOID + 0.5 * (END - VOID);
    check('gravy=0 maps to the exact midpoint retention time', Math.abs(mid.rt - expectedMid) < 1e-9);
    check('gravy=0 is not flagged off-scale', mid.offScale === false);

    // Extremely hydrophobic (all Ile, gravy=4.5) should clamp to HPLC_GRAVY_HI and hit the gradient end.
    const hydrophobic = w.estimateHplcRetention('IIIIIIIIII');
    check('very hydrophobic protein clamps to gradient end', Math.abs(hydrophobic.rt - END) < 1e-9);
    check('very hydrophobic protein flagged off-scale (raw gravy 4.5 > HI of 2)', hydrophobic.offScale === true);
    check('gravyClamped equals HPLC_GRAVY_HI', hydrophobic.gravyClamped === HI);

    // Extremely hydrophilic (all Arg, gravy=-4.5) should clamp to HPLC_GRAVY_LO and hit the void time.
    const hydrophilic = w.estimateHplcRetention('RRRRRRRRRR');
    check('very hydrophilic protein clamps to void time', Math.abs(hydrophilic.rt - VOID) < 1e-9);
    check('very hydrophilic protein flagged off-scale', hydrophilic.offScale === true);

    check('retention time is always within [void, end]',
      [mid, hydrophobic, hydrophilic].every(e => e.rt >= VOID - 1e-9 && e.rt <= END + 1e-9));
    dom.window.close();
  }

  // ---- Test 5: real-protein sanity check (EGFP) — plausible, in-range, non-NaN ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.document.getElementById('target').value = 'egfp';
    w.loadTarget();
    const VOID = S('HPLC_GRADIENT_VOID'), END = S('HPLC_GRADIENT_END');
    const seq = S('lastProduct.seq');
    const orf = w.bestORF(seq);
    const protein = w.translateDNA(seq.slice(orf.start, orf.complete ? orf.stopAt : seq.length));
    const est = w.estimateHplcRetention(protein);
    check('EGFP protein translates to a non-trivial length', protein.length > 50);
    check('EGFP HPLC estimate is not null', est !== null);
    check('EGFP gravy is a finite number', isFinite(est.gravy));
    check('EGFP retention time within modeled gradient bounds', est.rt >= VOID && est.rt <= END);
    dom.window.close();
  }

  // ---- Test 6: renderDogma() wires updateHplcEstimate on default boot (EGFP) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    const hydroSvg = d.getElementById('hydroChart').innerHTML;
    const hplcSvg = d.getElementById('hplcChart').innerHTML;
    const summary = d.getElementById('hplcSummary').textContent;
    check('hydroChart populated on default boot', hydroSvg.includes('<path'));
    check('hplcChart populated on default boot', hplcSvg.includes('<path') && hplcSvg.includes('<circle'));
    check('hplcSummary has content on default boot', summary.length > 0);
    check('hplcSummary mentions GRAVY', summary.includes('GRAVY'));
    check('no NaN in hydroChart SVG', !hydroSvg.includes('NaN'));
    check('no NaN in hplcChart SVG', !hplcSvg.includes('NaN'));
    check('no undefined in hplcSummary', !summary.includes('undefined'));
    check('zero console errors on boot', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 7: empty-protein state renders cleanly (no ORF found) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    // Frame 2 on the default EGFP product should very likely have no ATG in-frame near the start;
    // force a template with genuinely no ATG at all to guarantee the no-ORF branch.
    d.getElementById('template').value = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    d.getElementById('dogmaSource').value = 'template';
    w.renderDogma();
    const hydroLabel = d.getElementById('hydroChart').getAttribute('aria-label');
    const hplcLabel = d.getElementById('hplcChart').getAttribute('aria-label');
    check('hydroChart shows no-protein aria-label when no ORF', hydroLabel.includes('No translated protein yet'));
    check('hplcChart shows no-protein aria-label when no ORF', hplcLabel.includes('No translated protein yet'));
    check('hplcSummary shows guidance message when no ORF', d.getElementById('hplcSummary').textContent.includes('Translate a protein'));
    dom.window.close();
  }

  // ---- Test 8: colorblind toggle re-renders HPLC charts without throwing ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    let threw = false;
    try { w.toggleColorblindMode(); } catch (e) { threw = true; console.log(e.message); }
    check('colorblind toggle does not throw with HPLC charts present', !threw);
    const hplcSvg = w.document.getElementById('hplcChart').innerHTML;
    check('hplcChart still populated after toggle', hplcSvg.includes('<path'));
    dom.window.close();
  }

  // ---- Test 9: lab report includes the new HPLC section ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const report = w.buildLabReport();
    check('lab report includes Step 6\' HPLC section', report.includes("Step 6' - HPLC"));
    check('lab report HPLC section mentions GRAVY', report.includes('GRAVY'));
    dom.window.close();
  }

  // ---- Test 10: full target sweep — all 4 targets produce a sane, non-throwing HPLC render ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    let threw = false;
    for (const target of ['egfp', 'lacz', 'ubq', 'practice']) {
      d.getElementById('target').value = target;
      try { w.loadTarget(); } catch (e) { threw = true; console.log('target error', target, e.message); }
    }
    check('all 4 targets render HPLC without throw', !threw);
    check('zero console errors after full target sweep', errors.length === 0);
    const hplcSvg = d.getElementById('hplcChart').innerHTML;
    check('final hplcChart well-formed, no NaN/undefined', !hplcSvg.includes('NaN') && !hplcSvg.includes('undefined'));
    dom.window.close();
  }

  // ---- Test 11: "can't model yet" card no longer lists chromatography as unmodeled ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const cardText = Array.from(w.document.querySelectorAll('.card')).map(c => c.textContent).find(t => t.includes("can't model yet"));
    check('modelability card found', !!cardText);
    check('chromatography/HPLC no longer listed as unmodeled', cardText && !/Chromatography \(HPLC\)/.test(cardText));
    check('modelability card now credits Step 6\' HPLC as built', cardText && cardText.includes("Step 6′"));
    dom.window.close();
  }

  // ---- Test 12: regression — Gibson and primer-candidate features still work alongside this change ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.addGibsonTails();
    w.run();
    w.gibsonAssemble();
    check('gibson still succeeds after HPLC feature added', S('!!lastLigate') && S('lastLigate.method') === 'gibson');
    const fwdCandHtml = d.getElementById('fwdCandidates').innerHTML;
    check('primer candidates table still renders after HPLC feature added', fwdCandHtml.includes('<table'));
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
