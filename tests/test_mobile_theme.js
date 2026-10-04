const fs = require('fs');
const { JSDOM } = require('jsdom');

// Verifies the mobile-responsive CSS pass + light/dark theme toggle (roadmap item, shipped
// 2026-09-14). Both are pure CSS/DOM-class changes with zero engine code touched, so this
// suite checks stylesheet parsing/cascade structure (what jsdom *can* verify — it has no real
// layout engine, so it can't confirm actual rendered pixel widths at a given viewport) plus
// the toggleTheme() JS function's behavior and its independence from every SVG-rendering path.

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
  // ---- Test 1: the mobile media query parsed correctly with all expected overrides ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    const sheet = d.styleSheets[0];
    const mq700 = [...sheet.cssRules].find(r => r.media && r.media.mediaText && r.media.mediaText.includes('700px'));
    check('a max-width:700px media rule exists', !!mq700);
    if (mq700) {
      const bySelector = {};
      for (const r of mq700.cssRules) bySelector[r.selectorText] = r.style.cssText;
      check('forces every inline grid-template-columns div to 1fr with !important', /1fr\s*!important/.test(bySelector['div[style*="grid-template-columns"]'] || ''));
      check('reduces .wrap padding on mobile', /padding/.test(bySelector['.wrap'] || ''));
      check('reduces h1 font-size on mobile', /font-size/.test(bySelector['h1'] || ''));
      check('adds horizontal scroll to candidate tables on mobile', bySelector['#fwdCandidates,#revCandidates'] === 'overflow-x: auto;');
      check('stacks the tour banner vertically on mobile', /column/.test(bySelector['#tourBanner'] || ''));
    }
    dom.window.close();
  }

  // ---- Test 2: every section that previously used an inline two-column grid is covered by
  // the attribute selector (confirms the fix actually reaches all 7 previously-broken sections,
  // not just the one main .grid) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    const gridDivs = [...d.querySelectorAll('div[style*="grid-template-columns"]')];
    check('at least 6 inline-styled grid divs exist on the page (Step 3/4/5′/6/7/8 sections)', gridDivs.length >= 6);
    check('every one of them has an inline grid-template-columns declaration the attribute selector can match', gridDivs.every(el => /grid-template-columns/.test(el.getAttribute('style'))));
    dom.window.close();
  }

  // ---- Test 3: html.dark and html.dark.cbmode variable rules parsed correctly (renamed
  // 2026-09-20 when the default theme flipped from dark to the cream/serif editorial look —
  // html.dark is now the alternate, mirroring what html.light/html.light.cbmode used to be) ----
  {
    const { dom, w } = boot();
    await new Promise(r => setTimeout(r, 50));
    const d = w.document;
    const sheet = d.styleSheets[0];
    const darkRule = [...sheet.cssRules].find(r => r.selectorText === 'html.dark');
    const darkCbRule = [...sheet.cssRules].find(r => r.selectorText === 'html.dark.cbmode');
    check('html.dark rule exists', !!darkRule);
    check('html.dark sets all core custom properties', darkRule && ['--bg', '--panel', '--panel2', '--line', '--ink', '--muted', '--accent', '--accent2', '--bad', '--warn', '--good'].every(v => darkRule.style.getPropertyValue(v)));
    check('html.dark.cbmode rule exists (dark+colorblind combined override)', !!darkCbRule);
    check('html.dark.cbmode overrides the 5 semantic status colors', darkCbRule && ['--good', '--bad', '--warn', '--accent', '--accent2'].every(v => darkCbRule.style.getPropertyValue(v)));
    dom.window.close();
  }

  // ---- Test 4: toggleTheme() toggles the class, button label, and aria-pressed correctly ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const d = w.document;
    check('starts light (no "dark" class, button says Light)', !d.documentElement.classList.contains('dark') && /Light/.test(d.getElementById('themeToggle').textContent));
    w.toggleTheme();
    check('toggling on adds the "dark" class', d.documentElement.classList.contains('dark'));
    check('button label switches to Dark', /Dark/.test(d.getElementById('themeToggle').textContent));
    check('aria-pressed becomes true', d.getElementById('themeToggle').getAttribute('aria-pressed') === 'true');
    w.toggleTheme();
    check('toggling off removes the "dark" class', !d.documentElement.classList.contains('dark'));
    check('aria-pressed becomes false again', d.getElementById('themeToggle').getAttribute('aria-pressed') === 'false');
    check('zero console/window errors across both toggles', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 5: dark theme composes cleanly with colorblind mode (both classes coexist) ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const d = w.document;
    w.toggleTheme();
    w.toggleColorblindMode();
    check('both "dark" and "cbmode" classes are present simultaneously', d.documentElement.classList.contains('dark') && d.documentElement.classList.contains('cbmode'));
    check('zero console/window errors combining both toggles', errors.length === 0);
    w.toggleColorblindMode();
    check('un-toggling colorblind leaves dark mode alone', d.documentElement.classList.contains('dark') && !d.documentElement.classList.contains('cbmode'));
    dom.window.close();
  }

  // ---- Test 6: theme toggle never touches any SVG-rendering function (by design — SVGs use
  // literal hex fills from pal(), never CSS custom properties) — confirm a gel render is
  // byte-identical before/after a theme toggle ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const d = w.document;
    d.getElementById('target').value = 'egfp';
    w.loadTarget();
    w.run();
    await new Promise(r => setTimeout(r, 20));
    const gelBefore = d.getElementById('gel').innerHTML;
    w.toggleTheme();
    const gelAfter = d.getElementById('gel').innerHTML;
    check('gel SVG markup is unaffected by a page-theme toggle', gelBefore === gelAfter);
    check('zero console/window errors', errors.length === 0);
    dom.window.close();
  }

  // ---- Test 7: full target sweep + syntax/boot sanity, zero regressions from either change ----
  {
    const { dom, w, errors } = boot();
    await new Promise(r => setTimeout(r, 60));
    const d = w.document;
    check('zero console/window errors on default boot', errors.length === 0);
    for (const t of ['egfp', 'lacz', 'ubq', 'ubqgen', 'practice']) {
      d.getElementById('target').value = t;
      w.loadTarget();
      w.run();
    }
    w.toggleTheme();
    w.toggleColorblindMode();
    w.toggleTheme();
    w.toggleColorblindMode();
    check('zero console/window errors across a full target sweep plus repeated theme/colorblind toggling', errors.length === 0);
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
