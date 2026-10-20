"""Classification rules live with this step. Each run's traces and workbooks go to output/."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO / "output"
ENV_PATH = REPO / ".env"
