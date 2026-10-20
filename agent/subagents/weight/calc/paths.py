"""Rules stay in the delivery directory. Each run's traces and workbooks go to output/."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / "交付" / "exposure-weight-decision"
OUTPUT = REPO / "output"
