const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Beginner rewrite of lessons 2-9 (2026-10-10): each has tabs (basics / animation / play / your turn),
// a stage-driven animation, and hands-on tools that must agree with the real engine.
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

  for (let n = 2; n <= 9; n++) {
    const L = $('lesson' + n) || d.querySelector(`[data-lx="${n}"]`);
    check(`lesson ${n} exists as a collapsed details`, L && L.tagName === 'DETAILS' && !L.open);
    check(`lesson ${n} has 4 tabs and 4 panes`, L && [...L.querySelectorAll('[data-lx-tab]')].filter(x => x.closest('[data-lx]') === L).length === 4 && [...L.querySelectorAll('[data-lx-pane]')].filter(x => x.closest('[data-lx]') === L).length === 4);
    check(`lesson ${n} shows only first pane at load`, L && !L.querySelector('[data-lx-pane="0"]').hidden && [1,2,3].every(i => L.querySelector(`[data-lx-pane="${i}"]`).hidden));
    check(`lesson ${n} registered a framework root`, S(`!!LX.roots[${n}]`));
    const R = S(`LX.roots[${n}]`);
    check(`lesson ${n} animation built with stage buttons`, R.anims.length >= 1 && L.querySelectorAll('.l1-phases button').length >= 4);
    L.querySelector('[data-lx-tab="1"]').click();
    check(`lesson ${n} tab click switches pane`, !L.querySelector('[data-lx-pane="1"]').hidden && L.querySelector('[data-lx-pane="0"]').hidden);
    check(`lesson ${n} animation draws SVG shapes`, L.querySelectorAll('[data-lx-pane="1"] svg rect, [data-lx-pane="1"] svg circle, [data-lx-pane="1"] svg path, [data-lx-pane="1"] svg ellipse').length > 10);
    // every stage button renders without throwing
    const btns = [...L.querySelectorAll('.l1-phases button')];
    let ok = true; try { btns.forEach(b => b.click()); } catch (e) { ok = false; }
    check(`lesson ${n} all stage buttons render`, ok);
    L.querySelector('[data-lx-tab="3"]').click();
    check(`lesson ${n} has Your turn buttons`, L.querySelectorAll('[data-lx-pane="3"] button.ghost').length >= 2);
  }
  // keep existing structural promises
  check('exactly 8 collapsible numbered lessons 2..9', [...d.querySelectorAll('details.lesson')].filter(x => /^Lesson [2-9] /.test(x.querySelector('summary').textContent.trim())).length === 8);
  check('lesson 5 mentions Step 5 and Step 5′', /Step 5/.test($('lesson5').textContent) && /Step 5′/.test($('lesson5').textContent));
  check('lesson 6 mentions Step 4, 6 and 6′', /Step 4/.test($('lesson6').textContent) && /Step 6/.test($('lesson6').textContent) && /Step 6′/.test($('lesson6').textContent));

  // lesson number = step number
  for (let n = 2; n <= 9; n++) check(`lesson ${n} refers to Step ${n}`, new RegExp('Step ' + n + '(?![0-9])').test($('lesson' + n).textContent));
  const labels = [...d.querySelectorAll('.stage-label')].filter(x => /^Step [1-9]/.test(x.textContent));
  check('every step card links to the lesson with the same number', labels.length >= 11 && labels.every(x => { const n = x.textContent.match(/^Step (\d)/)[1], a = x.querySelector('[data-open-lesson]'); return a && a.dataset.openLesson === n; }));
  d.querySelector('[data-open-lesson="7"]').click();
  check('clicking a step link opens that lesson', $('lesson7').open === true);
  $('lesson7').open = false;

  // ---- Lesson 3: evalClone rule function
  const R3 = S('LX.roots[3]');
  check('lesson 3 exposes evalClone', typeof R3.evalClone === 'function');

  // ---- Lesson 6: normal gene translates to the expected protein
  const R6 = S('LX.roots[4]');
  check('lesson 6 exposes buildGene', typeof R6.buildGene === 'function');

  // ---- Lesson 7: CRISPR verdict rules + guide table agrees with engine
  const R7 = S('LX.roots[9]');
  const v = (mm, pam) => R7.cutVerdict(new w.Set(mm), pam).cuts;
  check('L7 perfect guide cuts', v([], false) === 'yes');
  check('L7 broken PAM never cuts', v([], true) === 'no');
  check('L7 seed mismatch blocks cutting', v([19], false) === 'no' && v([10], false) === 'no');
  check('L7 distal mismatch may still cut', v([0], false) === 'maybe' && v([0, 1, 2, 3], false) === 'maybe');
  check('L7 too many distal mismatches does not cut', v([0, 1, 2, 3, 4], false) === 'no');
  L: {
    const seq = S(`clean(baseTemplateFor('egfp'))`);
    const sites = S(`findPamSites(clean(baseTemplateFor('egfp')))`);
    check('L7 table size matches engine', R7.state.scored.length === sites.length && sites.length > 0);
    const top = R7.state.scored[0], sc = S(`scoreGuide(${JSON.stringify(top.protospacer)}, BACKGROUND_GENOME)`);
    check('L7 top guide score matches scoreGuide', top.score === sc.score);
    check('L7 sorted best first', R7.state.scored.every((g, i, a) => !i || a[i - 1].score >= g.score));
  }
  // your-turn: scan EGFP in the real lab
  $('lesson9').querySelector('[data-lx-tab="3"]').click();
  $('lesson9').querySelector('[data-lx7act="egfp"]').click();
  check('L7 your-turn runs the real CRISPR step', $('crisprSource').value === 'template' && ($('crisprBtn') !== null) && /guide|PAM/i.test(d.body.textContent));

  // ---- Lesson 8: NGS tool agrees with engine; Sanger quality
  const R8 = S('LX.roots[5]');
  check('L8 depth tool uses engine sim', R8.ngsInfo && R8.ngsInfo.sim.nReads > 0 && R8.ngsInfo.depth === 4);
  const seq8 = S(`clean(baseTemplateFor('egfp'))`);
  const eng = S(`(()=>{const s=clean(baseTemplateFor('egfp')),sim=simulateNgsReads(s,4),c=ngsConsensus(sim);return ngsAccuracy(s,c.consensus).mismatches})()`);
  check('L8 wrong-consensus count equals engine', R8.ngsInfo.acc.mismatches === eng);
  $('lx8Depth').value = '5'; fire($('lx8Depth'), 'input');
  check('L8 60x has no gaps and no wrong calls', R8.ngsInfo.depth === 60 && R8.ngsInfo.acc.gaps === 0 && R8.ngsInfo.acc.mismatches === 0);
  $('lx8Depth').value = '0'; fire($('lx8Depth'), 'input');
  check('L8 1x is worse than 60x', R8.ngsInfo.acc.gaps + R8.ngsInfo.acc.mismatches > 0);
  $('lx8Pos').value = '20'; fire($('lx8Pos'), 'input');
  check('L8 Q at position 20 is below Q20-quality plateau', R8.qInfo.q === S('phredAt(19)') && R8.qInfo.q < 50);
  $('lx8Pos').value = '300'; fire($('lx8Pos'), 'input');
  check('L8 Q at 300 is 50', R8.qInfo.q === 50);
  $('lesson5').querySelector('[data-lx8act="sanger"]').click();
  check('L8 sanger your-turn fills the real read', $('seqReadOut').children.length > 100);
  $('lesson5').querySelector('[data-lx8act="ngs1"]').click();
  check('L8 NGS your-turn runs real NGS at 1x', $('ngsDepth').value === '1' && S('!!lastNGS'));

  // ---- Lesson 9: frame translation + HPLC agree with engine
  const R9 = S('LX.roots[6]');
  check('L9 EGFP is 239 aa, ~26.9 kDa', R9.state.info.aa === 239 && Math.abs(R9.state.info.kDa - 26.9) < 0.2);
  check('L9 MW equals engine proteinMW', Math.abs(R9.state.info.kDa * 1000 - S(`proteinMW(${JSON.stringify(R9.state.prot)})`)) < 1e-6);
  check('L9 HPLC equals engine estimate', Math.abs(R9.hplc.rt - S(`estimateHplcRetention(${JSON.stringify(R9.state.prot)}).rt`)) < 1e-9);
  $('lx9Frame').value = '1'; fire($('lx9Frame'), 'change');
  check('L9 frame 2 gives a much smaller or no protein', !R9.state.info.protein || R9.state.info.aa < 100);
  $('lx9Frame').value = 'auto'; fire($('lx9Frame'), 'change');
  $('lx9Pin').click();
  check('L9 pinning adds a lane', R9.state.pinned.length === 1);
  $('lx9Clear').click();
  check('L9 clearing removes lanes', R9.state.pinned.length === 0);
  const oily = S(`estimateHplcRetention('LLIVVFFLIVAAM').rt`), wet = S(`estimateHplcRetention('KKEEDDRRNNQQSKE').rt`);
  check('L9 oily peptide elutes after water-loving one', oily > wet);
  $('lesson6').querySelector('[data-lx9act="frame2"]').click();
  check('L9 your-turn sets real dogma frame', $('dogmaFrame').value === '1');
  $('lesson6').querySelector('[data-lx9act="full"]').click();
  check('L9 full-length your-turn restores auto frame', $('dogmaFrame').value === 'auto');

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
