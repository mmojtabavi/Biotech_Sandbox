"""Render a virtual agarose gel from PCR products.

DNA migrates a distance ~ inversely proportional to log(fragment size).
We map log(bp) -> vertical position: large fragments stay near the wells
(top), small fragments run toward the bottom. This is the visual feedback
that turns a computed PCR result into something a learner can *read*.
"""
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

LADDER = [10000, 5000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 100]

def _y(size, top=0.90, bottom=0.08, lo=100, hi=10000):
    """Log-scale migration -> y in [bottom, top]. Bigger = higher."""
    size = max(min(size, hi), lo)
    frac = (math.log10(size) - math.log10(lo)) / (math.log10(hi) - math.log10(lo))
    return bottom + frac * (top - bottom)

def render_gel(lanes, outfile, title="Virtual agarose gel (1% / 100 bp ladder)"):
    """lanes: list of (label, [ (size, intensity in 0..1), ... ])."""
    n = len(lanes) + 1
    fig, ax = plt.subplots(figsize=(1.4 * n + 1.5, 6.4))
    ax.set_facecolor("#0b0f14")
    fig.patch.set_facecolor("#0b0f14")
    lane_w = 0.62

    def draw_lane(x, bands, is_ladder=False):
        # well
        ax.add_patch(Rectangle((x - lane_w/2, 0.925), lane_w, 0.02,
                               color="#1b2430", ec="#33404f"))
        for size, inten in bands:
            y = _y(size)
            glow = "#8ef5c0" if not is_ladder else "#6fb3ff"
            # soft band with a little vertical blur via stacked rects
            for k, a in ((0.0, 0.20), (0.004, 0.35), (0.008, 0.12)):
                ax.add_patch(Rectangle((x - lane_w/2, y - 0.006 - k),
                                       lane_w, 0.012 + 2*k,
                                       color=glow, alpha=a * inten))
            ax.add_patch(Rectangle((x - lane_w/2, y - 0.004),
                                   lane_w, 0.008, color=glow, alpha=0.9 * inten))
            if is_ladder:
                ax.text(x - lane_w/2 - 0.06, y, f"{size:,}", ha="right",
                        va="center", color="#9fb4cc", fontsize=7)

    # ladder in lane 0
    draw_lane(1, [(s, 0.8) for s in LADDER], is_ladder=True)
    ax.text(1, 0.965, "Ladder", ha="center", color="#9fb4cc", fontsize=8)

    for i, (label, bands) in enumerate(lanes, start=2):
        draw_lane(i, bands)
        if not bands:
            ax.text(i, 0.50, "no band", ha="center", va="center",
                    color="#e06c6c", fontsize=8, style="italic", rotation=90)
        ax.text(i, 0.965, label, ha="center", color="#cfe0f2", fontsize=7.5)

    ax.set_xlim(0.3, n + 0.7)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_title(title, color="#dfe9f4", fontsize=11, pad=12)
    fig.tight_layout()
    fig.savefig(outfile, dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)
    return outfile
