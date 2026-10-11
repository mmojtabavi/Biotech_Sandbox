const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
// Step 1/2 interactive views: primer-pairing view, interactive gel, digest map. They must agree with the real engine.
const html = fs.readFileSync(path.join(__dirname, '..', 'pcr-lab.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }
(async () => {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.onerror = m => errors.push(m);
  await new Promise(r => setTimeout(r, 200));
  const w = dom.window, d = w.document, S = e => w.eval(e), $ = id => d.getElementById(id);
  const fire = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true }));

  check('pairing view sits inside the Step 1 card, right under the primers', $('pairView') && $('pairView').previousElementSibling === $('revm') && !$('outputCard').contains($('pairView')));
  check('annealing slider moved into the pairing view', $('pairView').contains($('atemp')));
  check('digest view sits in the Step 2 card next to the controls', $('digestView') && $('digestView').previousElementSibling === $('enzInfo'));
  check('gel has an info panel and a mirror copy', $('gelInfo') && $('gelMirror'));
  check('output card is marked for sticky layout via CSS', /#outputCard\{position:sticky/.test(html));

  // ---- clean primers
  S("loadPreset('clean')"); S('run()');
  let L = S('PV.last');
  check('clean: both primers classified ok', L['Forward primer'].kind === 'ok' && L['Reverse primer'].kind === 'ok');
  check('pairing view shows 2 blocks + a map', d.querySelectorAll('#pvBody .pv-block').length === 2 && !!d.querySelector('#pvBody .pv-map'));
  const f = $('fwd').value;
  check('forward alignment shows all primer bases', [...d.querySelectorAll('#pvBody .pv-block')[0].querySelectorAll('text.pv-base:not(.tpl):not(.new)')].map(t => t.textContent).join('') === f);
  check('clean: no mismatch marks', d.querySelectorAll('#pvBody .pv-x').length === 0);
  check('chips show engine Tm', d.querySelector('#pvBody .pv-head').textContent.includes(S(`tm(${JSON.stringify(f)})`).toFixed(1)));
  check('clean: extension bases drawn', d.querySelectorAll('#pvBody .pv-base.new').length >= 4);

  // ---- 3' mismatch
  S("loadPreset('mm3')"); S('run()');
  L = S('PV.last');
  check("3' mismatch: reverse classified 'three' (same cause as the engine's diagnosis)", L['Reverse primer'].kind === 'three' && /3′ base is mismatched/.test($('diag').textContent));
  check("3' mismatch: red mismatch mark drawn and no green extension on that primer", d.querySelectorAll('#pvBody .pv-block')[1].querySelectorAll('.pv-x').length >= 1 && d.querySelectorAll('#pvBody .pv-block')[1].querySelectorAll('.pv-base.new').length === 0);
  check("3' mismatch: no band in the gel, like the engine", $('verdict').textContent.includes('No band'));
  check('animation classes present after Run', d.querySelectorAll('#pvBody .pv-a-drop').length >= 2);

  // ---- low Tm
  S("loadPreset('lowtm')"); S('run()');
  L = S('PV.last');
  check("low Tm primer classified hot/short (engine: no band)", ['hot', 'short'].includes(L['Forward primer'].kind) && $('verdict').textContent.includes('No band'));

  // ---- annealing temperature drives the verdict live
  S("loadPreset('clean')"); S('run()');
  $('atemp').value = '72'; fire($('atemp'), 'input');
  L = S('PV.last');
  const rr = S(`runPCR(document.getElementById('template').value, document.getElementById('fwd').value, document.getElementById('rev').value, 72)`);
  check('annealing 72°C: view agrees with engine on success/failure', (L['Forward primer'].kind === 'ok' && L['Reverse primer'].kind === 'ok') === rr.success);
  $('atemp').value = '58'; fire($('atemp'), 'input');
  check('annealing 58°C: both ok again', S('PV.last')['Forward primer'].kind === 'ok');

  // ---- nonspecific
  S("loadPreset('nonspec')"); S('run()');
  check('nonspecific: map shows >1 amplicon warning', /different amplicons/.test($('pvBody').textContent) && $('verdict').textContent.includes('nonspecific'));

  // ---- gel interactivity
  S("loadPreset('clean')"); S('run()');
  const hit = d.querySelector('#gel .gel-hit');
  check('gel bands have hit areas with size', hit && +hit.dataset.size === S('lastProduct.size'));
  check('gel band migration animation present', !!d.querySelector('#gel animateTransform'));
  hit.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('clicking a band explains it', /amplicon/.test($('gelInfo').textContent) && $('gelInfo').textContent.includes(String(S('lastProduct.size'))));
  check('mirror gel holds the same bands', d.querySelectorAll('#gelMirror .gel-band').length === d.querySelectorAll('#gel .gel-band').length);
  check('ladder bracket helper', S("PV.bracket(717)").includes('700') && S("PV.bracket(717)").includes('1,000'));

  // ---- digest view
  $('enzyme').value = 'AluI'; fire($('enzyme'), 'change');
  check('digest preview before pressing Digest', /Preview/.test($('dvBody').textContent));
  S('digestProduct()');
  const frags = S(`digestMulti(lastProduct.seq, ['AluI']).frags.slice().sort((a,b)=>a-b)`);
  const segs = S(`PV.dvSegments(lastProduct.seq, ['AluI']).map(s=>s.size).sort((a,b)=>a-b)`);
  check('digest map fragments equal the engine digest', JSON.stringify(frags) === JSON.stringify(segs));
  check('digest map draws one piece per fragment', d.querySelectorAll('#dvBody .dv-seg').length === frags.length);
  check('hovering a piece lights its gel band', (() => { const seg = d.querySelector('#dvBody .dv-seg[data-size="216"]'); seg.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })); return !!d.querySelector('#gel .gel-band.on'); })());
  S('clearDigest()');
  $('enzyme').value = 'EcoRI'; fire($('enzyme'), 'change'); S('digestProduct()');
  check('no-site enzyme explains the failure with the closest look-alike', /No cut/.test($('dvBody').textContent) && /look-alike|Nothing even looks/.test($('dvBody').textContent));

  check('no script errors', errors.length === 0);
  if (errors.length) console.log(errors);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
