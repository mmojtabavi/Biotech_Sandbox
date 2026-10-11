// Lessons 5 (Sequencing) and 6 (Protein analysis): presence, placement, and that every
// claim their "Try" instructions make actually holds in the engine.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'pcr-lab.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('FAIL:', name); } };

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window, d = w.document;
const T = id => (d.getElementById(id) || {}).textContent || '';

setTimeout(() => {
  check('boots with zero errors', errors.length === 0);

  // Presence and placement
  const summaries = [...d.querySelectorAll('details.lesson > summary')].map(s => s.textContent.trim());
  // Lesson 1 is always open (not a collapsible <details>); Lessons 2-9 are collapsible.
  check('Lesson 1 is on the page', /Lesson 1 · How PCR works/i.test(d.body.textContent));
  const lessonTitles = summaries.filter(t => /^Lesson \d+ ·/.test(t));
  check('8 collapsible lessons (2-9), so 9 lessons in total', lessonTitles.length === 8);
  check('collapsible lessons numbered 2..9 in order', lessonTitles.every((t, i) => t.startsWith(`Lesson ${i + 2} ·`)));
  const i5 = summaries.findIndex(t => t.startsWith('Lesson 5 ·'));
  const i6 = summaries.findIndex(t => t.startsWith('Lesson 6 ·'));
  check('Lesson 5 is about sequencing (Step 5)', /Sequencing/.test(summaries[i5] || ''));
  check('Lesson 6 is about protein analysis (Step 6)', /Protein analysis/.test(summaries[i6] || ''));
  check('Lessons 5 and 6 are adjacent and sit between Lessons 4 and 7', i5 > 0 && i6 === i5 + 1 && summaries[i5 - 1].startsWith('Lesson 4 ·') && summaries[i6 + 1].startsWith('Lesson 7 ·'));
  check('Lessons 5 and 6 start collapsed', !d.getElementById('lesson5').open && !d.getElementById('lesson6').open);
  check('Lesson 5 refers to Steps 5 and 5′', /Step 5\b/.test(d.getElementById('lesson5').textContent) && /Step 5′/.test(d.getElementById('lesson5').textContent));
  check('Lesson 6 refers to Steps 4, 6 and 6′', ['Step 4', 'Step 6 ', 'Step 6′'].every(k => d.getElementById('lesson6').textContent.includes(k.trim())));

  // Lesson 5 (sequencing) claims
  d.getElementById('target').value = 'egfp'; w.loadTarget(); w.run();
  d.getElementById('seqSource').value = 'product-fwd'; w.renderSequencing();
  const fwd = T('seqSummary');
  check('Sanger forward read has a noisy start then a high-confidence region', /noisy/.test(fwd) && /Q≥20/.test(fwd));
  d.getElementById('seqSource').value = 'product-rev'; w.renderSequencing();
  check('Sanger reverse-primer read works', /Reverse primer/i.test(T('seqSummary')));
  d.getElementById('seqSource').value = 'plasmid'; w.renderSequencing();
  check('plasmid read asks for a ligation first', /Ligate a construct in Step 3 first/.test(T('seqSummary')));
  d.getElementById('seqSource').value = 'product-fwd'; w.renderSequencing();

  d.getElementById('ngsSource').value = 'product';
  d.getElementById('ngsDepth').value = '1'; w.runNGS();
  const m1 = T('ngsSummary').match(/(\d+) positions ended up with zero coverage/);
  check('NGS at 1× leaves zero-coverage gaps', !!m1 && +m1[1] > 0);
  d.getElementById('ngsDepth').value = '30'; w.runNGS();
  const s30 = T('ngsSummary');
  check('NGS at 30× covers every position', /every position was covered/.test(s30));
  check('NGS at 30× still has individual read errors', /(\d+) simulated base-calling errors/.test(s30) && +s30.match(/(\d+) simulated base-calling errors/)[1] > 0);

  // Lesson 6 (protein) claims
  const prot = T('proteinSummary');
  check('EGFP translates to 239 aa', /239 aa/.test(prot));
  check('EGFP is about 26.9 kDa', /26\.9 kDa/.test(prot));
  check('ladder has 25 and 37 kDa markers', w.eval('PROTEIN_LADDER.includes(25) && PROTEIN_LADDER.includes(37)'));
  d.getElementById('dogmaFrame').value = '1'; w.renderDogma();
  const kda2 = parseFloat((T('proteinSummary').match(/([\d.]+) kDa/) || [])[1]);
  const smallest = w.eval('Math.min(...PROTEIN_LADDER)');
  check('Frame 2 gives a truncated protein below the smallest ladder marker', kda2 > 0 && kda2 < smallest);
  check('Frame 2 hits an early stop codon', /stop codon/.test(T('dogmaSummary')));
  d.getElementById('dogmaFrame').value = 'auto'; w.renderDogma();
  check('switching back to Auto restores full-length EGFP', /239 aa/.test(T('proteinSummary')));

  const egfpHplc = T('hplcSummary');
  const results = {};
  for (const t of ['ubq', 'lacz']) {
    d.getElementById('target').value = t; w.loadTarget(); w.run(); w.renderDogma();
    results[t] = { kda: T('proteinSummary').match(/([\d.]+) kDa/)[1], hplc: T('hplcSummary').match(/roughly ([\d.]+) min/)[1] };
  }
  const egfpMin = egfpHplc.match(/roughly ([\d.]+) min/)[1];
  check('Ubiquitin and lacZα give different gel sizes from EGFP', results.ubq.kda !== '26.9' && results.lacz.kda !== '26.9');
  check('Ubiquitin and lacZα give different HPLC times from EGFP', results.ubq.hplc !== egfpMin && results.lacz.hplc !== egfpMin);

  check('still zero errors after the whole walkthrough', errors.length === 0);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 700);
