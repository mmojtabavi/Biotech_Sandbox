const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Lesson 1 beginner rewrite (2026-10-10): tabs, PCR-cycle animation, primer playground,
// doubling simulator, and the "Your turn" buttons that drive Step 1. The playground must
// agree with the real engine (runPCR) on the three rules, so that is checked directly.
const html = fs.readFileSync(path.join(__dirname, '..', 'pcr-lab.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }

(async () => {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.onerror = (m) => errors.push(m);
  await new Promise(r => setTimeout(r, 80));
  const w = dom.window, d = w.document, S = e => w.eval(e);
  const $ = id => d.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

  check('lesson 1 exists and is still the first, always-open lesson', $('lesson1') && d.querySelector('.lesson') === $('lesson1') && $('lesson1').tagName === 'DIV');
  check('5 tabs and 5 panes', d.querySelectorAll('[data-l1tab]').length === 5 && [0,1,2,3,4].every(i => $('l1pane-' + i)));
  check('only the first pane is visible at load', !$('l1pane-0').hidden && [1,2,3,4].every(i => $('l1pane-' + i).hidden));
  $('l1tab-2').click();
  check('clicking a tab switches pane', $('l1pane-0').hidden && !$('l1pane-2').hidden && $('l1tab-2').getAttribute('aria-selected') === 'true');

  // pairing toy
  $('l1PairIn').value = 'atgc'; fire($('l1PairIn'), 'input');
  check('pairing toy shows complements', $('l1PairOut').textContent.replace(/\s|Strand|Partner/g, '') === 'ATGCTACG');

  // animation: build + render each phase without errors
  check('animation SVG built', $('l1Anim').querySelectorAll('rect').length > 60);
  S('L1.pause()');
  for (const [t, ph] of [[0.5,'start'],[3,'denature'],[6,'anneal'],[10,'extend'],[14,'done']]) {
    S(`L1.anim.t=${t}; L1.renderAnim()`);
    check(`phase chip highlights ${ph}`, d.querySelector('[data-l1phase].on') && d.querySelector('[data-l1phase].on').dataset.l1phase === ph);
  }
  check('thermometer reads 72 °C during extension', /72 °C/.test($('l1Anim').textContent));

  // playground agrees with the engine's rules
  const PT = 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGC';
  const TAIL = 'GCGGCCGCAGGCGCGCCGGCTCGCAG'; // GC-rich so the reverse primer is never the limiting one
  const tmpl = PT + S('mkTemplate(7,300)') + TAIL;
  const engineBand = (primer, at) => {
    // forward primer = playground primer; a fixed clean reverse primer far downstream
    const rev = S(`revcomp(${JSON.stringify(TAIL)})`);
    const R = S(`runPCR(${JSON.stringify(tmpl)}, ${JSON.stringify(primer)}, ${JSON.stringify(rev)}, ${at})`);
    if (!R.products.some(p => p.size === tmpl.length)) return 'none';
    return R.products.find(p => p.size === tmpl.length).faint ? 'faint' : 'strong';
  };
  const setPrimer = (seq, at) => { $('l1Temp').value = at; $('l1PrimerIn').value = seq; fire($('l1PrimerIn'), 'input'); return S('L1.evalPrimer()'); };
  const cases = [
    ['clean 20-mer @58', PT.slice(0, 20), 58],
    ['12-mer @58', PT.slice(0, 12), 58],
    ['16-mer @58', PT.slice(0, 16), 58],
    ['3′ mismatch', PT.slice(0, 19) + 'C', 58],
    ['middle mismatch', PT.slice(0, 10) + 'C' + PT.slice(11, 20), 58],
    ['20-mer @66', PT.slice(0, 20), 66],
    ['20-mer @70', PT.slice(0, 20), 70],
  ];
  for (const [name, seq, at] of cases) {
    const r = setPrimer(seq, at);
    check(`playground matches engine: ${name} (${r.outcome})`, r.outcome === engineBand(seq, at));
  }
  check('3′ mismatch is reported as rule 3 failing', (setPrimer(PT.slice(0, 19) + 'C', 58), /doesn’t pair/.test($('l1Checks').children[2].textContent)));

  // quick buttons
  d.querySelector('[data-l1mut=reset]').click();
  check('reset → 20-mer, 58 °C, strong', S('L1.evalPrimer().L') === 20 && $('l1Temp').value === '58' && S('L1.evalPrimer().outcome') === 'strong');
  d.querySelector('[data-l1mut=end]').click();
  check('3′-end mismatch button → no band', S('L1.evalPrimer().outcome') === 'none');
  d.querySelector('[data-l1mut=short]').click();
  check('too-short button → 12-mer, no band', S('L1.evalPrimer().L') === 12 && S('L1.evalPrimer().outcome') === 'none');

  // doubling
  const a = S(`(()=>{document.getElementById('l1Start').value='1';document.getElementById('l1Eff').value='100';return L1.series();})()`);
  check('perfect doubling: 2^10 after 10 cycles', Math.abs(a[10] - 1024) < 1);
  check('plateau: never exceeds 1 trillion', a.every(v => v <= 1e12 + 1));
  check('formatting', S('L1.fmtBig(1.07e9)') === '1.07 billion' && S('L1.fmtBig(512)') === '512');
  $('l1Scale').click();
  check('log-scale toggle', $('l1Scale').getAttribute('aria-pressed') === 'true' && /1 million/.test($('l1Chart').textContent));

  // your turn → drives Step 1
  d.querySelector('[data-l1act=mm3]').click();
  check('3′ mismatch button breaks the real PCR', /3′ base is mismatched/.test($('diag') ? $('diag').textContent : d.body.textContent));
  d.querySelector('[data-l1act=clean]').click();
  check('clean button selects EGFP and gives a clean band', $('target').value === 'egfp' && /Clean amplification/.test(d.body.textContent));

  check('no script errors', errors.length === 0);
  console.log(errors.join('\n'));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
