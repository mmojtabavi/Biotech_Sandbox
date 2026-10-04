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
  // ---- Test 1: UBQGEN construction & intron detection ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const UBQ = S('UBQ'), UBQGEN = S('UBQGEN'), approx = S('UBQGEN_INTRON_APPROX');
    check('UBQGEN length = UBQ + intron', UBQGEN.length === UBQ.length + S('UBQGEN_INTRON').length);
    check('UBQGEN starts with GT of intron at approx.start', UBQGEN.substr(approx.start, 2) === 'GT');
    check('UBQGEN ends intron with AG at approx.start+approx.len', UBQGEN.substr(approx.start + approx.len - 2, 2) === 'AG');
    const hit = w.findIntronNear(UBQGEN, approx.start, approx.len);
    check('findIntronNear finds the intron', !!hit);
    check('found start matches expected', hit && hit.start === approx.start);
    check('found end matches expected', hit && hit.end === approx.start + approx.len);
    dom.window.close();
  }

  // ---- Test 2: splicing reconstructs the EXACT original CDS ----
  {
    const { dom, w, S } = boot();
    await new Promise(r => setTimeout(r, 50));
    const UBQ = S('UBQ'), UBQGEN = S('UBQGEN'), approx = S('UBQGEN_INTRON_APPROX');
    const hit = w.findIntronNear(UBQGEN, approx.start, approx.len);
    const spliced = w.spliceOutIntron(UBQGEN, hit);
    check('spliced sequence === original UBQ CDS exactly', spliced === UBQ);
    check('spliced translates to the real 76-aa ubiquitin protein', w.translateDNA(spliced.slice(0, spliced.length - 3)) === w.translateDNA(UBQ.slice(0, UBQ.length - 3)));
    const protein = w.translateDNA(spliced.slice(0, spliced.length - 3));
    check('protein is 76 aa', protein.length === 76);
    check('protein starts with the real ubiquitin N-terminus (MQIFVKTLTGK)', protein.startsWith('MQIFVKTLTGK'));
    dom.window.close();
  }

  // ---- Test 3: donor/acceptor scoring correctness ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    check('scoreSpliceDonor rejects non-GT start', w.scoreSpliceDonor('AAACCCGGGTTT', 3) === -Infinity);
    check('scoreSpliceDonor scores a perfect consensus highly', w.scoreSpliceDonor('CAGGTAAGTAAA', 3) >= 30);
    check('scoreSpliceAcceptor rejects non-AG end', w.scoreSpliceAcceptor('TTTTTTTTTTTTTTAC', 16) === -Infinity);
    check('scoreSpliceAcceptor scores a clean polypyrimidine+AG tract highly', w.scoreSpliceAcceptor('TTTTTTTTTTTTTTAG', 16) >= 15);
    dom.window.close();
  }

  // ---- Test 4: the REAL safety property — renderDogma() only ever looks for an intron when
  // TARGET is the genomic target. (The scoring function itself, called directly on an arbitrary
  // sequence at an arbitrary window, isn't guaranteed to find nothing — short real sequences do
  // contain occasional coincidental GT...AG pairs with moderate consensus scores, which is exactly
  // why the app never runs a blind scan; see the scope note in the source. Safety comes from the
  // target-gating in renderDogma, verified end-to-end here, not from the scorer refusing all input.)
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    ['egfp', 'lacz', 'ubq', 'practice'].forEach(t => {
      doc.getElementById('target').value = t;
      w.loadTarget();
      const panel = doc.getElementById('splicePanel').innerHTML.trim();
      check(`splice panel stays empty for target=${t}`, panel.length === 0);
      const summary = doc.getElementById('dogmaSummary').innerHTML;
      check(`dogma summary for target=${t} is never marked Spliced`, !/Spliced/i.test(summary));
    });
    check('zero console/window errors across that sweep', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 5: full page boot on the ubqgen target — zero console errors, splicing UI populated ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    doc.getElementById('target').value = 'ubqgen';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    check('zero console/window errors after switching to ubqgen and running', errors.length === 0);
    check('TARGET global updated to ubqgen', S('TARGET') === 'ubqgen');
    check('template textarea shows the genomic (322 bp) sequence', doc.getElementById('template').value.length === 322);
    const verdict = doc.getElementById('verdict').textContent;
    check('PCR verdict rendered something (not stuck on placeholder)', verdict && verdict.length > 0);
    const splicePanel = doc.getElementById('splicePanel').innerHTML;
    check('splice panel is non-empty for the genomic target', splicePanel.trim().length > 0);
    check('splice panel mentions the donor/acceptor consensus check', /donor/i.test(splicePanel) && /acceptor/i.test(splicePanel));
    // The PCR-product amplicon is trimmed by the reverse primer and doesn't quite reach the
    // natural stop codon — the same known, pre-existing, already-documented limitation the other
    // real targets have (EGFP/lacZα's full ORF is likewise only visible via "template", not
    // "product" — see PROJECT_STATUS). Splicing itself still works correctly on the trimmed
    // product (verified below); for the FULL 76-aa complete protein, switch to "template".
    const chipProduct = doc.getElementById('proteinLenChip').textContent;
    check('protein length chip on the (trimmed) product shows an incomplete ORF, not garbage', /aa \(incomplete\)/.test(chipProduct));
    const summary = doc.getElementById('dogmaSummary').innerHTML;
    check('dogma summary notes the sequence was spliced', /Spliced/i.test(summary));

    doc.getElementById('dogmaSource').value = 'template';
    w.renderDogma();
    await new Promise(r => setTimeout(r, 20));
    const chipTemplate = doc.getElementById('proteinLenChip').textContent;
    check('protein length chip on the full template shows the complete 76 aa protein', /76 aa/.test(chipTemplate) && !/incomplete/.test(chipTemplate));
    const summaryTemplate = doc.getElementById('dogmaSummary').innerHTML;
    check('template-source summary also notes splicing', /Spliced/i.test(summaryTemplate));
    check('zero console/window errors after switching dogma source', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 6: switching AWAY from ubqgen clears the splice panel (no stale content) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    doc.getElementById('target').value = 'ubqgen';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    doc.getElementById('target').value = 'egfp';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    check('zero console/window errors across a target switch away from ubqgen', errors.length === 0);
    const splicePanel = doc.getElementById('splicePanel').innerHTML;
    check('splice panel is cleared for a non-genomic target', splicePanel.trim().length === 0);
    const chip = doc.getElementById('proteinLenChip').textContent;
    check('EGFP still translates normally after visiting ubqgen (no cross-contamination)', /239 aa/.test(chip));
    dom.window.close();
  }

  // ---- Test 7: ELISA works on ubqgen (shares ubq's Kd — same mature protein) ----
  {
    const { dom, w, S, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    doc.getElementById('target').value = 'ubqgen';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    w.runElisa();
    await new Promise(r => setTimeout(r, 20));
    check('zero console/window errors after running ELISA on ubqgen', errors.length === 0);
    const lastElisa = S('lastElisa');
    check('ELISA available (not gated) for ubqgen', lastElisa !== null);
    check('ubqgen ELISA Kd matches ubq (180 nM)', lastElisa && lastElisa.kdNm === 180);
    dom.window.close();
  }

  // ---- Test 8: full 4-real-target + practice sweep still boots clean (regression) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice'].forEach(t => {
      doc.getElementById('target').value = t;
      w.loadTarget();
    });
    await new Promise(r => setTimeout(r, 50));
    check('zero console/window errors across a full target sweep incl. ubqgen', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 9: lab report includes the splice note for ubqgen ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    doc.getElementById('target').value = 'ubqgen';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    w.generateLabReport();
    await new Promise(r => setTimeout(r, 20));
    const report = doc.getElementById('reportOut').value;
    check('zero console/window errors generating a lab report for ubqgen', errors.length === 0);
    check('lab report mentions splicing', /[Ss]plic/.test(report));
    dom.window.close();
  }

  // ---- Test 10: save/share round trip for the ubqgen target ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 50));
    const doc = w.document;
    doc.getElementById('target').value = 'ubqgen';
    w.loadTarget();
    await new Promise(r => setTimeout(r, 50));
    w.generateShareCode();
    const code = doc.getElementById('shareOut').value;
    check('a save code was generated for ubqgen', code && code.length > 0);

    const boot2 = boot();
    const { dom: dom2, w: w2, S: S2, errors: errors2 } = boot2;
    await new Promise(r => setTimeout(r, 50));
    const doc2 = dom2.window.document;
    doc2.getElementById('shareIn').value = code;
    w2.loadShareCode();
    await new Promise(r => setTimeout(r, 50));
    check('zero console/window errors restoring a ubqgen save code on a fresh page', errors2.length === 0);
    check('restored TARGET is ubqgen', S2('TARGET') === 'ubqgen');
    check('restored template is the 322 bp genomic sequence', doc2.getElementById('template').value.length === 322);
    dom.window.close(); dom2.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
