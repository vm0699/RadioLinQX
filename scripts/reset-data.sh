#!/usr/bin/env bash
# Wipe the dashboard's JSON "database" (cases, referring doctors, settings,
# presets, notification read-state). Next API start re-seeds deterministically
# from sample-data/ + synthetic history. Does NOT touch DICOM files or Orthanc.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${DATA_DIR:-$ROOT/data}"
rm -rf "$DIR"
echo "✓ cleared $DIR — restart the API to re-seed"
