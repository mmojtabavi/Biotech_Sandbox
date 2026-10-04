"""
PCR + Gel virtual wet-lab engine — feasibility prototype.

Computes a PCR outcome from real biochemistry:
  - primer binding-site search on both strands, with mismatch handling
  - 3'-end mismatch penalty (biologically, a 3' mismatch blocks extension)
  - nearest-neighbor Tm and GC via primer3
  - primer-dimer / hairpin screening via primer3
  - amplicon prediction (size + sequence)
  - human-readable failure diagnostics ("why it didn't work")

This is a teaching engine: real enough to build correct intuition,
simple enough to explain every result.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import primer3

COMPLEMENT = str.maketrans("ACGTacgt", "TGCAtgca")

def revcomp(seq: str) -> str:
    return seq.translate(COMPLEMENT)[::-1]

def gc_percent(seq: str) -> float:
    seq = seq.upper()
    return 100.0 * (seq.count("G") + seq.count("C")) / len(seq) if seq else 0.0

def primer_tm(seq: str) -> float:
    # primer3 nearest-neighbor Tm (default salt/conc conditions)
    return primer3.calc_tm(seq.upper())

# ---- binding-site search -------------------------------------------------

@dataclass
class Binding:
    start: int          # 0-based start on the plus strand
    end: int            # exclusive end on the plus strand
    strand: str         # '+' (forward primer) or '-' (reverse primer)
    mismatches: int     # total mismatches in the annealing footprint
    three_prime_ok: bool  # is the 3'-most base a match?
    eff_tm: float       # Tm reduced for mismatches

def _find_sites(primer: str, template: str, max_mismatch: int = 3):
    """Find near-matches of `primer` (as it would anneal) on the plus strand.

    A forward primer's sequence appears directly on the plus strand; its 3'
    end points right. A reverse primer anneals to the plus strand, so its
    reverse-complement appears on the plus strand; its 3' end points left.
    We search both and tag the strand.
    """
    primer = primer.upper()
    L = len(primer)
    tmpl = template.upper()
    base_tm = primer_tm(primer)
    hits = []

    # Forward orientation: primer matches plus strand directly.
    for i in range(len(tmpl) - L + 1):
        window = tmpl[i:i + L]
        mm = sum(a != b for a, b in zip(primer, window))
        if mm <= max_mismatch:
            three_ok = primer[-1] == window[-1]          # 3' base is last char
            hits.append(Binding(i, i + L, "+", mm, three_ok,
                                 base_tm - 3.0 * mm))

    # Reverse orientation: reverse-complement of primer matches plus strand.
    rc = revcomp(primer)
    for i in range(len(tmpl) - L + 1):
        window = tmpl[i:i + L]
        mm = sum(a != b for a, b in zip(rc, window))
        if mm <= max_mismatch:
            # primer's 3' base corresponds to the FIRST base of the rc footprint
            three_ok = rc[0] == window[0]
            hits.append(Binding(i, i + L, "-", mm, three_ok,
                                 base_tm - 3.0 * mm))
    return hits

# ---- reaction ------------------------------------------------------------

@dataclass
class Amplicon:
    start: int
    end: int
    size: int
    seq: str
    fwd: Binding
    rev: Binding
    faint: bool = False

@dataclass
class PCRResult:
    products: list = field(default_factory=list)   # list[Amplicon]
    diagnostics: list = field(default_factory=list) # list[str]
    fwd_tm: float = 0.0
    rev_tm: float = 0.0
    fwd_gc: float = 0.0
    rev_gc: float = 0.0
    heterodimer_tm: float = 0.0
    fwd_hairpin_tm: float = 0.0
    rev_hairpin_tm: float = 0.0
    success: bool = False

def run_pcr(template: str, fwd: str, rev: str,
            annealing_temp: float = 58.0,
            max_amplicon: int = 5000,
            max_mismatch: int = 3) -> PCRResult:
    r = PCRResult()
    fwd, rev = fwd.upper(), rev.upper()
    r.fwd_tm, r.rev_tm = primer_tm(fwd), primer_tm(rev)
    r.fwd_gc, r.rev_gc = gc_percent(fwd), gc_percent(rev)
    r.heterodimer_tm = primer3.calc_heterodimer(fwd, rev).tm
    r.fwd_hairpin_tm = primer3.calc_hairpin(fwd).tm
    r.rev_hairpin_tm = primer3.calc_hairpin(rev).tm

    fwd_sites = [b for b in _find_sites(fwd, template, max_mismatch) if b.strand == "+"]
    rev_sites = [b for b in _find_sites(rev, template, max_mismatch) if b.strand == "-"]

    # --- primer-level warnings (teaching signals) ---
    if r.heterodimer_tm > annealing_temp - 5:
        r.diagnostics.append(
            f"Primer-dimer risk: the two primers anneal to each other (dimer Tm "
            f"{r.heterodimer_tm:.1f}°C). They may amplify each other instead of your template.")
    for name, tm in (("Forward", r.fwd_hairpin_tm), ("Reverse", r.rev_hairpin_tm)):
        if tm >= annealing_temp:
            r.diagnostics.append(
                f"{name} primer folds into a stable hairpin (Tm {tm:.1f}°C ≥ annealing "
                f"{annealing_temp}°C), which competes with template binding.")

    # --- productive binding requires: intact 3' end AND Tm high enough to anneal ---
    def productive(sites, name):
        good, weak = [], []
        for b in sites:
            if not b.three_prime_ok:
                continue
            if b.eff_tm >= annealing_temp:
                good.append(b)
            elif b.eff_tm >= annealing_temp - 5:
                good.append(b); weak.append(b)   # faint band
            # else: too weak to anneal at this temp -> not productive
        if sites and not any(b.three_prime_ok for b in sites):
            r.diagnostics.append(
                f"{name} primer binds, but its 3' base is mismatched — the polymerase "
                f"can't extend it, so no product.")
        elif not good and sites:
            best = max((b.eff_tm for b in sites if b.three_prime_ok), default=0)
            r.diagnostics.append(
                f"{name} primer's effective Tm ({best:.1f}°C) is too far below the "
                f"annealing temperature ({annealing_temp}°C) to bind — lower the annealing "
                f"temp or redesign a longer / higher-GC primer.")
        elif not sites:
            r.diagnostics.append(f"{name} primer has no binding site on the template (too many mismatches).")
        return good, weak

    good_fwd, weak_fwd = productive(fwd_sites, "Forward")
    good_rev, weak_rev = productive(rev_sites, "Reverse")

    # --- pair up into amplicons (fwd must be upstream of rev) ---
    for f in good_fwd:
        for rv in good_rev:
            if f.start < rv.end:
                size = rv.end - f.start
                if size <= max_amplicon:
                    r.products.append(Amplicon(
                        f.start, rv.end, size, template.upper()[f.start:rv.end], f, rv))

    r.products.sort(key=lambda a: a.size)
    faint = set(id(b) for b in weak_fwd + weak_rev)
    for a in r.products:
        a.faint = id(a.fwd) in faint or id(a.rev) in faint
    if r.products:
        r.success = True
        if len(r.products) == 1:
            a = r.products[0]
            tag = " (faint — a primer binds weakly at this temp)" if a.faint else ""
            r.diagnostics.insert(0, f"Clean amplification: single {a.size} bp product{tag}.")
        else:
            sizes = ", ".join(f"{a.size} bp" for a in r.products)
            r.diagnostics.insert(0, f"Multiple products ({sizes}) — primers bind more than one place (nonspecific).")
    elif good_fwd and good_rev and not r.products:
        r.diagnostics.append("Both primers bind productively, but not in an orientation/distance that yields a product.")

    return r
