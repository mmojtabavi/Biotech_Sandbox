"""End-to-end demo: run PCR across scenarios and render one virtual gel."""
import random
from pcr_engine import run_pcr, revcomp
from gel import render_gel

random.seed(7)
template = "".join(random.choice("ACGT") for _ in range(1200))
fwd_good = template[100:122]
rev_good = revcomp(template[678:700])

# A second real amplicon for a multi-band demo (fwd binds twice).
# Insert a duplicate of the forward site further downstream to force 2 products.
dup_template = template[:900] + template[100:122] + template[900:]
rev_far = revcomp(dup_template[1000:1022])

scenarios = [
    ("Clean\n600bp",  template,     fwd_good,                          rev_good),
    ("3' mismatch",   template,     fwd_good,                          rev_good[:-1] + "T"),
    ("Low Tm",        template,     template[100:112],                 rev_good),
    ("Wrong primer",  template,     "GGGGCCCCGGGGCCCCGGGGCC",          rev_good),
    ("Nonspecific",   dup_template, template[100:122],                 rev_far),
]

lanes = []
for label, tmpl, f, r in scenarios:
    res = run_pcr(tmpl, f, r, annealing_temp=58.0)
    bands = [(a.size, 0.5 if a.faint else 1.0) for a in res.products]
    lanes.append((label, bands))
    print(f"{label:14s} -> {[a.size for a in res.products] or 'NO BAND'}")

out = render_gel(lanes, "virtual_gel.png")
print("Wrote", out)
