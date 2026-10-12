"""Run OpenChatLink from a checkout without installing dependencies."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "integrations" / "phasepal" / "src"))
from openchatlink.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
