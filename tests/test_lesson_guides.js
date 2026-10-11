const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// In-card beginner guides for the prime steps (3', 3'', 5', 6'): tabs, animation, hands-on tools
// that must agree with the real engine, and "Your turn" buttons that drive the real step.
const html = fs.readFileSync(path.join(__dirname, '..', 'pcr-lab.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }

(async () => {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.onerror = m => errors.push(m);
  await new Promise(r => setTimeout(r, 150));
  const w = dom.window, d = w.document, S = e => w.eval(e);
  const $ = id => d.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

  const guides = { 10: 'Step 3′', 11: 'Step 3″', 12: 'Step 5′', 13: 'Step 6′' };
  for (const n of [10, 11, 12, 13]) {
    const G = $('lguide' + n);
    check(`guide ${n} exists as collapsed details inside its lesson`, G && G.tagName === 'DETAILS' && !G.open && G.closest('details.lesson'));
    const LES = { 10: 3, 11: 3, 12: 5, 13: 6 };
    check(`guide ${n} sits inside Lesson ${LES[n]} (same lesson as ${guides[n]})`, G && G.closest('details.lesson').id === 'lesson' + LES[n]);
    check(`guide ${n} summary names ${guides[n]}`, G && G.querySelector('summary').textContent.includes(guides[n]));
    check(`guide ${n} is not counted as a numbered lesson`, !G.classList.contains('lesson'));
    check(`guide ${n} has 4 tabs/panes, first visible`, G.querySelectorAll('[data-lx-tab]').length === 4 && G.querySelectorAll('[data-lx-pane]').length === 4 && !G.querySelector('[data-lx-pane="0"]').hidden && G.querySelector('[data-lx-pane="1"]').hidden);
    const R = S(`LX.roots[${n + 10}]`);
    check(`guide ${n} registered`, !!R && R.anims.length === 1);
    G.querySelector('[data-lx-tab="1"]').click();
    check(`guide ${n} animation draws shapes`, G.querySelectorAll('[data-lx-pane="1"] svg rect, [data-lx-pane="1"] svg circle, [data-lx-pane="1"] svg ellipse').length > 15);
    let ok = true; try { G.querySelectorAll('.l1-phases button').forEach(b => b.click()); } catch (e) { ok = false; }
    check(`guide ${n} all stage buttons render`, ok && G.querySelectorAll('.l1-phases button').length >= 4);
    G.querySelector('[data-lx-tab="3"]').click();
    check(`guide ${n} has Your turn buttons`, G.querySelectorAll('[data-lx-pane="3"] button').length >= 1);
  }
  check('lesson guides do not break lesson tabs (outer tabs unchanged)', [3,5,6].every(n => S(`LX.roots[${n}].tabs.length`) === d.querySelectorAll(`#lesson${n} > .l1-tabs [data-lx-tab]`).length))
  check('step cards no longer contain the guides', !d.querySelector('.card details.lxstep') && !$('guide10') && !$('guide13'))
  check('existing step cards still present', ['gibsonBtn', 'ggBtn', 'ngsBtn', 'hplcChart'].every(id => $(id)));
  check('still exactly 8 numbered lessons', [...d.querySelectorAll('details.lesson')].filter(x => /^Lesson [2-9] /.test(x.querySelector('summary').textContent.trim())).length === 8);

  // ---- Gibson
  const R10 = S('LX.roots[20]');
  $('lx20Len').value = '20'; fire($('lx20Len'), 'input');
  const arms = S('gibsonHomologyArms(MCS_POS.EcoRI, 20)');
  check('Gibson arm display equals engine arm', $('lx20L').textContent === arms.left && $('lx20R').textContent === arms.right);
  check('Gibson Tm equals engine tm()', Math.abs(R10.lenInfo.tl - S(`tm(${JSON.stringify(arms.left)})`)) < 1e-9);
  $('lx20Len').value = '9'; fire($('lx20Len'), 'input');
  check('short overlap triggers the low-Tm warning like the engine rule', R10.lenInfo.low === true);
  check('pairVerdict identical overlaps pair', R10.pairVerdict('TGCCCGTACCCTGGCGGACA', 'TGCCCGTACCCTGGCGGACA').res === 'yes');
  check('pairVerdict one mismatch is weak', R10.pairVerdict('TGCCCGTACCCTGGCGGACA', 'TGCCCGTACACTGGCGGACA').res === 'weak');
  check('pairVerdict 3 mismatches fails', R10.pairVerdict('TGCCCGTACCCTGGCGGACA', 'TGCCCGAACACTGGCGGACT').res === 'no');
  check('pairVerdict too short fails', R10.pairVerdict('TGCCCGTACC', 'TGCCCGTACC').res === 'no');
  
  d.querySelector('[data-lx20act]').click();
  check('Gibson your-turn assembles with the real engine', S('lastLigate && lastLigate.method') === 'gibson');

  // ---- Golden Gate
  const R11 = S('LX.roots[21]');
  const vec = S('goldenGateOverhangs(GG_CUT_POS, GG_OVERHANG_LEN)');
  check('GG default overhangs equal the engine vector overhangs and fit', R11.ggVerdict(vec.left, vec.right).res === 'yes');
  check('GG swapped overhangs do not fit', R11.ggVerdict(vec.right, vec.left).res === 'no');
  check('GG one wrong letter does not fit', R11.ggVerdict('A' + vec.left.slice(1), vec.right).res === 'no');
  check('GG palindrome flagged', R11.ggVerdict('GCGC', vec.right).warn.some(m => /palindromic/.test(m)));
  check('GG incomplete overhang reported', R11.ggVerdict('GC', vec.right).res === 'incomplete');
  check('GG site scan finds both orientations', R11.siteScan('AAGGTCTCAAGAGACCTT').length === 2);
  check('GG site scan on EGFP agrees with direct search', R11.scan.length === (S(`clean(baseTemplateFor('egfp'))`).match(/GGTCTC|GAGACC/g) || []).length);
  $('lx21Src').value = 'custom'; fire($('lx21Src'), 'change');
  check('GG custom sequence with sites is flagged', R11.scan.length >= 2 && /BsaI site/.test($('lx21Scan').textContent));
  d.querySelector('[data-lx21act="good"]').click();
  check('GG good your-turn assembles', S('lastLigate && lastLigate.method') === 'golden-gate');
  d.querySelector('[data-lx21act="bad"]').click();
  check('GG broken overhang is rejected by the real engine', S('lastLigate') === null && /doesn.t match/.test($('ggDiag').textContent));

  // ---- NGS
  const R12 = S('LX.roots[22]'), st = R12.state;
  $('lx22Depth').value = '2'; fire($('lx22Depth'), 'input');
  const eng = S(`(()=>{const s=clean(baseTemplateFor('egfp')),sim=simulateNgsReads(s,4),c=ngsConsensus(sim);return {n:sim.nReads,m:ngsAccuracy(s,c.consensus).mismatches}})()`);
  check('NGS read count matches engine', st.sim.nReads === eng.n);
  check('NGS wrong-consensus count matches engine', st.acc.mismatches === eng.m);
  check('NGS vote panel counts equal the number of covering reads', st.vote && st.vote.tot === st.vote.cnt.A + st.vote.cnt.C + st.vote.cnt.G + st.vote.cnt.T && st.vote.tot > 0);
  $('lx22Next').click();
  check('NGS next error advances', st.idx === 1);
  $('lx22Depth').value = '5'; fire($('lx22Depth'), 'input');
  check('NGS 60x is clean', st.acc.gaps === 0 && st.acc.mismatches === 0);
  $('lx22Depth').value = '0'; fire($('lx22Depth'), 'input');
  check('NGS 1x is worse', st.acc.gaps + st.acc.mismatches > 0);
  d.querySelector('[data-lx22act="1"]').click();
  check('NGS your-turn runs the real simulation at 1x', $('ngsDepth').value === '1' && S('!!lastNGS && lastNGS.depth') === 1);

  // ---- HPLC
  const R13 = S('LX.roots[23]');
  const names = R13.rows.map(r => r.name);
  check('HPLC default mix lists selected samples sorted by retention', R13.rows.every((r, i, a) => !i || a[i - 1].rt <= r.rt) && names.includes('EGFP') && !names.includes('lacZα'));
  const eg = R13.rows.find(r => r.name === 'EGFP');
  const prot = S(`(()=>{const d=clean(baseTemplateFor('egfp')),o=bestORF(d);return translateDNA(d.substr(o.start,o.len))})()`);
  check('HPLC EGFP retention equals engine', Math.abs(eg.rt - S(`estimateHplcRetention(${JSON.stringify(prot)}).rt`)) < 1e-9);
  check('HPLC oily elutes after water-loving', R13.rows.find(r => r.name === 'Oily peptide').rt > R13.rows.find(r => r.name === 'Water-loving peptide').rt);
  check('HPLC overlap warning shown for EGFP and Ubiquitin', /overlap/.test($('lx23Out').textContent));
  $('lx23Own').value = 'MKTAYIAKQR'; fire($('lx23Own'), 'input');
  check('HPLC own peptide adds a row', R13.rows.some(r => r.name === 'Yours'));
  d.querySelector('[data-lx23act]').click();
  check('HPLC your-turn fills the real Step 6′ trace', $('hplcChart').innerHTML.length > 50);

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
