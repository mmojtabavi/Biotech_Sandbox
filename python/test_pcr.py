"""Exercise the PCR engine across success + failure scenarios."""
import random
from pcr_engine import run_pcr, revcomp, primer_tm

random.seed(7)
# A realistic 1200 bp template with balanced GC.
template = "".join(random.choice("ACGT") for _ in range(1200))

# Pull a real forward primer (pos 100) and real reverse primer (pos 700).
fwd_good = template[100:122]                    # 22-mer, binds plus strand
rev_good = revcomp(template[678:700])           # 22-mer, binds minus strand -> ~600 bp product

scenarios = []

# 1. Clean success
scenarios.append(("Clean amplification", fwd_good, rev_good))

# 2. 3'-end mismatch on the reverse primer (last base wrong) -> no extension
rev_3mm = rev_good[:-1] + {"A":"C","C":"A","G":"T","T":"G"}[rev_good[-1]]
scenarios.append(("3' mismatch on reverse primer", fwd_good, rev_3mm))

# 3. Too-short / low-Tm primer
fwd_short = template[100:112]                    # 12-mer, low Tm
scenarios.append(("Low-Tm (too short) forward primer", fwd_short, rev_good))

# 4. Primer that doesn't exist in the template at all
scenarios.append(("Forward primer absent from template", "GGGGCCCCGGGGCCCCGGGGCC", rev_good))

# 5. Self-complementary primer pair -> primer-dimer
dimer_a = "ACGTACGTACGTACGTACGTAC"
dimer_b = revcomp(dimer_a)
scenarios.append(("Primer-dimer-prone pair", dimer_a, dimer_b))

for title, f, r in scenarios:
    print("=" * 70)
    print(title)
    print("-" * 70)
    res = run_pcr(template, f, r, annealing_temp=58.0)
    print(f"  Fwd: {f}  (Tm {res.fwd_tm:.1f}°C, GC {res.fwd_gc:.0f}%)")
    print(f"  Rev: {r}  (Tm {res.rev_tm:.1f}°C, GC {res.rev_gc:.0f}%)")
    print(f"  Heterodimer Tm: {res.heterodimer_tm:.1f}°C")
    print(f"  Products: {[a.size for a in res.products] or 'NONE'}")
    print(f"  Verdict: {'BAND(S)' if res.success else 'NO BAND'}")
    for d in res.diagnostics:
        print(f"    • {d}")
    print()
