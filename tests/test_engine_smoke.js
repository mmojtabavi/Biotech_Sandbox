const fs = require('fs');
const { JSDOM } = require('jsdom');

// NOTE (fixed 2026-09-14, scheduled autonomous run): this suite used to boot a hand-built
// stub HTML plus `lab-engine.js` — an orphaned extraction from the abandoned, untracked
// multi-page-site-split experiment (see PROJECT_STATUS.md's "Open question for Naz"), frozen
// at whatever state that file was in on 2026-08-11 (save/share v:4, no Gibson tail-button UI,
// no Golden Gate/ELISA/splicing/specificity/NGS at all). That meant every changelog entry from
// 2026-08-11 onward that cited "test_engine_smoke.js: 17/17 passing" as evidence of a clean
// regression on `pcr-lab.html` was actually verifying a different, stale file that pcr-lab.html
// had already diverged from by several features and three save/share version bumps — a real
// verification-integrity gap, not a product/architecture decision like the multi-page split
// itself. Fixed by booting the real, current `pcr-lab.html` directly (same pattern every other
// test suite in this project already uses, e.g. test_gibson.js's `boot()`), keeping every
// original check's intent intact. `lab-engine.js` itself is left untouched — deleting/adopting
// the multi-page split is still Naz's call, unchanged from prior runs' guidance.
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
  const { dom, w, S, errors } = boot();
  await new Promise(r => setTimeout(r, 50));

  check('zero errors booting pcr-lab.html', errors.length === 0);
  if (errors.length) console.log(errors);

  const d = w.document;
  d.getElementById('target').value = 'egfp';
  w.loadTarget();

  let threw = false;
  try {
    w.run();
  } catch (e) { threw = true; console.log('run() threw:', e.message, e.stack); }
  check('run() does not throw with auto-designed EGFP primers', !threw);
  check('lastProduct set after run()', S('!!lastProduct'));
  // Note: pickPrimer's reverse-primer search region doesn't always reach the natural stop codon
  // (documented pre-existing behavior in PROJECT_STATUS.md), so the amplicon is legitimately a
  // little short of the full 720bp EGFP CDS.
  check('lastProduct size is a plausible EGFP amplicon (700-720bp)', S('lastProduct && lastProduct.size') >= 700 && S('lastProduct.size') <= 720);
  check('verdict shows amplified', d.getElementById('verdict').textContent.includes('amplified'));
  check('gel svg populated', d.getElementById('gel').innerHTML.length > 100);

  w.digestProduct();
  check('digestProduct() sets lastDigest', S('!!lastDigest'));
  check('EGFP + EcoRI has no double-sticky insert (expected, no native site)', S('challengeState.readyInsert') === false);

  d.getElementById('tailEnzymeFwd').value = 'EcoRI';
  d.getElementById('tailEnzymeRev').value = 'EcoRI';
  w.addCloningTails();
  w.run();
  check('tailed run still succeeds', S('!!lastProduct'));
  w.digestProduct();
  check('tailed digest has a ligatable insert', S('challengeState.readyInsert') === true);
  d.getElementById('vecEnzyme').value = 'EcoRI';
  w.ligate();
  check('ligate() succeeds with matching EcoRI tails', S('!!lastLigate') && S('lastLigate.method') === 'restriction');
  check('challenge1 fully complete', S('challengeState.clean && challengeState.readyInsert && challengeState.ligated'));

  const code = S('encodeState(buildStateObject())');
  const decoded = w.decodeState(code);
  check('save code round-trips target', decoded.target === 'egfp');
  check('save code round-trips current version (v:8)', decoded.v === 8);
  check('save code captures ligation via vecEnzyme', decoded.vecEnzyme === 'EcoRI');

  dom.window.close();

  // ---- Gibson path on a fresh boot (separate DOM instance, since Gibson needs its own primers) ----
  {
    const { dom: dom2, w: w2, S: S2 } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d2 = w2.document;
    d2.getElementById('target').value = 'egfp';
    w2.loadTarget();
    w2.addGibsonTails();
    w2.run();
    check('gibson-prep: PCR succeeded', S2('!!lastProduct'));
    w2.gibsonAssemble();
    check('gibson: assembly succeeded', S2('!!lastLigate') && S2('lastLigate.method') === 'gibson');
    dom2.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
