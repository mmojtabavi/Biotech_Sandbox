# PCR + Gel MVP — Technical Feasibility Spike

*July 2026 · verdict: **feasible**, and the core already runs*

## What this spike set out to answer

Can we compute a PCR outcome from real biochemistry — well enough that a learner supplies real sequences, gets a real result, sees a virtual gel, and understands *why* it worked or failed? Not a scripted simulation; a real model.

**Answer: yes.** A working prototype in this folder does exactly that, end to end, in ~200 lines of Python built on mature open-source libraries. It handles a clean amplification and four distinct failure modes, each with a correct, human-readable explanation, and renders a virtual gel that reads like a real one.

## What the prototype actually does

Given a template sequence and a primer pair, the engine computes:

- **Primer chemistry** — nearest-neighbor melting temperature (Tm) and GC content, via `primer3` (the same engine behind Primer3/Primer-BLAST).
- **Binding-site search** — scans both strands for where each primer anneals, allowing mismatches, tracking the 3' terminal base specifically.
- **Extension gating** — a 3'-end mismatch blocks extension (no product), matching real polymerase behavior; a primer whose effective Tm is well below the annealing temperature won't bind.
- **Secondary structure** — primer-dimer (heterodimer) and hairpin Tm, via `primer3`, flagged when they'd out-compete template binding.
- **Amplicon prediction** — pairs productive forward/reverse sites into products, computes size and sequence, and detects multiple (nonspecific) products.
- **Diagnostics** — plain-English "why" for every outcome, e.g. *"Reverse primer binds, but its 3' base is mismatched — the polymerase can't extend it, so no product."*
- **Virtual gel** — log-size migration against a 100 bp ladder, rendered as an image.

## Proof: five scenarios, all biologically correct

| Scenario | Engine verdict | Teaching signal |
|---|---|---|
| Well-designed primers | Single 600 bp band | "Clean amplification." |
| 3'-end mismatch on reverse primer | No band | 3' base can't extend |
| Primer too short (Tm 42°C at 58°C anneal) | No band | "Lower the annealing temp or redesign." |
| Primer absent from template | No band | No binding site |
| Forward primer binds twice | Two bands (122 + 922 bp) | Nonspecific amplification |

The gel image (`virtual_gel.png`) shows the 600 bp product correctly positioned between the 500 and 700 ladder rungs, the nonspecific lane with two bands, and "no band" in the three failure lanes. This is the whole learning loop — *do → see result → understand why → retry* — running on real computation.

## Architecture (what productionizing looks like)

```
Learner UI (primer designer + "Run PCR" + gel view)
        │  sequence + primers + annealing temp
        ▼
PCR engine  (Python service)
   ├─ primer3-py   → Tm, GC, dimer, hairpin        [wrap, don't build]
   ├─ binding search → sites, mismatches, 3' state  [our logic]
   ├─ amplicon builder → products, sizes            [our logic]
   └─ diagnostics → "why it failed" explanations     [our IP + pedagogy]
        ▼
Gel renderer  (matplotlib now; SVG/canvas in the browser later)
```

The valuable, defensible part is **not** the biophysics (that's `primer3`, open and battle-tested) — it's the **binding/extension logic + the diagnostic/teaching layer** wrapped around it. That's the moat: turning a correct computation into a correct *lesson*.

## Build vs. wrap

**Wrap** the physics: `primer3-py` for Tm/dimer/hairpin, Biopython for sequence handling. These are decades-mature; rebuilding them would be wasted effort and less accurate.

**Build** the teaching layer: binding-site semantics, extension rules, failure taxonomy, and the plain-language explanations tied to each computed cause. This spike already implements a first version of all of it.

## Accuracy vs. honesty — the right bar for teaching

The goal is *correct intuition*, not a lab-grade predictor. The prototype deliberately uses transparent, explainable rules (3' mismatch blocks extension; Tm-below-anneal fails to bind) rather than an opaque model, because every outcome must be explainable to a learner. Known simplifications to tune later:

- Mismatch penalty is linear; real annealing is position-weighted (mismatches near the 3' end matter far more). Easy, high-value upgrade.
- Band intensity is coarse (full/faint); could scale with predicted efficiency.
- No modeling yet of GC-rich stalling, long-amplicon extension-time limits, or Mg²⁺/salt effects — all addable as optional "advanced realism" without breaking the teaching core.

None of these block an MVP. They're the roadmap from "teaches correctly" to "predicts precisely."

## Risks and how the spike retires them

- **"Is the biology real, or hand-wavy?"** — Retired. Uses the same Tm/dimer engine as professional primer-design tools; failure modes match textbook PCR.
- **"Can failures be explained, not just flagged?"** — Retired. Every no-band result carries a specific, correct cause.
- **"Does the visual feedback work?"** — Retired. The gel renders and reads correctly against a standard ladder.
- **Remaining open risk:** UX and content — turning this engine into paced lessons with good "what to try next" scaffolding. That's design work, not a technical unknown.

## Effort estimate to a usable MVP

The engine core exists (this spike). Remaining work to a learner-facing PCR + gel module:

- Web UI: interactive primer designer, run button, animated gel — ~2–3 weeks.
- Engine hardening: position-weighted mismatches, efficiency-scaled intensity, real target sequences (pull from GenBank) — ~1–2 weeks.
- Pedagogy: 4–6 guided lessons + a challenge or two, using the engine's own diagnostics to drive hints — ~2 weeks with a domain writer.

Roughly a **6–8 week MVP** for a single, genuinely-hands-on PCR + gel module — the first thing no competitor (Labster, Rosalind) offers.

## Files in this spike

- `pcr_engine.py` — the PCR computation engine (real biochemistry + diagnostics).
- `gel.py` — virtual agarose gel renderer.
- `test_pcr.py` — the five scenarios with full printed diagnostics.
- `demo.py` — end-to-end run that produces the gel image.
- `virtual_gel.png` — the rendered gel proving the visual loop.

## Bottom line

The hardest-sounding part of the concept — "compute real wet-lab results, not a scripted sim" — is the part that's *already working*. PCR + gel is the right flagship: the physics is a solved, wrappable problem, and the value you add is the layer that turns a correct number into a correct lesson. That's buildable now.
