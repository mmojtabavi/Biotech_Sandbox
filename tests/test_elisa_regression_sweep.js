// Quick regression sweep: since this run's ELISA feature touched run(), loadTarget(), and
// toggleColorblindMode() (all shared, high-traffic functions), confirm all 4 targets x all 4
// presets still boot/run without throwing, the gel still renders, and a full amplify->digest->
// ligate->qPCR->ELISA pipeline plus a colorblind toggle all still work together on EGFP.
const fs = require('fs');
const { JSDOM } = require('jsdom');
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
  // 4 targets x 4 presets, no throw
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    for (const t of ['egfp', 'lacz', 'ubq', 'practice']) {
      S(`document.getElementById('target').value='${t}'`);
      w.loadTarget();
      for (const preset of ['clean', 'mm3', 'lowtm', 'nonspec']) {
        let threw = false;
        try { w.loadPreset(preset === 'clean' ? undefined : preset); } catch (e) { threw = true; console.log(e); }
        check(`${t}/${preset}: no throw`, !threw);
      }
    }
    check('zero console errors across full target x preset sweep', errors.length === 0);
    check('gel svg has content', S("document.getElementById('gel').innerHTML.length") > 50 || S("document.getElementById('pcrGel')") !== null);
    dom.window.close();
  }

  // full pipeline on EGFP: amplify -> tail -> digest -> ligate -> qPCR -> ELISA -> colorblind toggle
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    S("document.getElementById('target').value='egfp'"); w.loadTarget();
    S("document.getElementById('tailEnzymeFwd').value='EcoRI'");
    S("document.getElementById('tailEnzymeRev').value='EcoRI'");
    w.addCloningTails();
    w.run();
    check('PCR product exists after tailed run', S('lastProduct') !== null);
    S("document.getElementById('enzyme').value='EcoRI'");
    w.digestProduct();
    check('digest produced a result', S('lastDigest') !== null);
    S("document.getElementById('vecEnzyme').value='EcoRI'");
    w.ligate();
    check('ligation succeeded', S('lastLigate') !== null);
    w.runQPCR();
    check('qPCR ran', S('lastQPCR') !== null);
    w.runElisa();
    check('ELISA ran', S('lastElisa') !== null);
    w.toggleColorblindMode();
    check('after colorblind toggle: ligation state preserved', S('lastLigate') !== null);
    check('after colorblind toggle: qPCR state preserved', S('lastQPCR') !== null);
    check('after colorblind toggle: ELISA state preserved', S('lastElisa') !== null);
    const report = w.buildLabReport();
    check('lab report mentions ligation', report.includes('Step 3'));
    check('lab report mentions qPCR', report.includes('Step 7'));
    check('lab report mentions ELISA', report.includes('Step 8'));
    check('zero console errors across full pipeline', errors.length === 0);
    dom.window.close();
  }

  // full guided tour still completes without throw
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    w.startTour();
    let steps = 0, threw = false;
    try {
      while (steps < 20) {
        const hasNext = S("document.getElementById('tourCard')") !== null;
        if (!hasNext) break;
        w.tourNext();
        steps++;
      }
    } catch (e) { threw = true; console.log(e); }
    check('guided tour ran without throwing', !threw);
    check('zero console errors during tour', errors.length === 0);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
