#!/usr/bin/env bash
# Populate Orthanc (STOW-RS) from sample-data/. If Orthanc isn't reachable this
# still works as a "fetch sample data" step — the API's local mode reads
# sample-data/ directly, no Orthanc required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

SAMPLE_DIR="sample-data"
ORTHANC_HTTP_PORT="${ORTHANC_HTTP_PORT:-8042}"
ORTHANC_USERNAME="${ORTHANC_USERNAME:-radiolinq}"
ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-change-me-orthanc}"
BASE="http://localhost:${ORTHANC_HTTP_PORT}"
AUTH=(-u "${ORTHANC_USERNAME}:${ORTHANC_PASSWORD}")

have_dicom() {
  find "$SAMPLE_DIR" -type f \( -iname '*.dcm' -o -iname '*.dicom' -o -iname '*.ima' \) 2>/dev/null | head -1 | grep -q .
}

# --- 1. make sure there is something to load -----------------------------
if ! have_dicom; then
  echo "ℹ  ${SAMPLE_DIR}/ has no DICOM files — fetching public samples (no PHI)…"
  mkdir -p "$SAMPLE_DIR/mri-t1"
  # datalad/example-dicom-structural : real 384-slice T1 MRI (MIT-like terms)
  RAW="https://raw.githubusercontent.com/datalad/example-dicom-structural/master/dicoms"
  if seq -w 1 384 | sed 's/^/0/' | \
       xargs -P 12 -I{} curl -sfL -m 40 -o "$SAMPLE_DIR/mri-t1/N2D_{}.dcm" "$RAW/N2D_{}.dcm"; then
    echo "✓  downloaded 384-slice MRI series"
  else
    echo "⚠  MRI download incomplete (offline?)."
  fi
  # a few single-file demos (rubomedical) for XA / US / RF coverage
  mkdir -p "$SAMPLE_DIR/demo"
  for n in 0002 0003 0015 0020; do
    curl -sfL -m 60 "https://www.rubomedical.com/dicom_files/dicom_viewer_${n}.zip" -o "/tmp/rd_${n}.zip" \
      && unzip -o -q "/tmp/rd_${n}.zip" -d "$SAMPLE_DIR/demo/" || true
  done
  have_dicom || { echo "✗  still no DICOM files — drop some into ${SAMPLE_DIR}/ and re-run."; exit 1; }
fi

# --- 2. push to Orthanc if it's up --------------------------------------
if ! curl -sf "${AUTH[@]}" "${BASE}/system" >/dev/null 2>&1; then
  cat <<EOF
ℹ  Orthanc not reachable at ${BASE} — skipping upload.
   The app's local mode already serves ${SAMPLE_DIR}/ directly:
     GET /api/mode           -> { "mode": "local" }
     GET /api/local/studies
   Start Orthanc later with:  docker compose up -d orthanc  &&  ./scripts/load-dicom.sh
EOF
  exit 0
fi

echo "▶  Uploading $(find "$SAMPLE_DIR" -type f | wc -l) file(s) to Orthanc via STOW-RS…"
ok=0; fail=0
while IFS= read -r f; do
  [ -s "$f" ] || continue
  head -c 132 "$f" | tail -c 4 | grep -q DICM || continue
  code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
    -X POST "${BASE}/dicom-web/studies" \
    -H "Content-Type: application/dicom" --data-binary "@${f}")
  [[ "$code" =~ ^20 ]] && ok=$((ok+1)) || { fail=$((fail+1)); echo "  ! $f -> HTTP $code"; }
done < <(find "$SAMPLE_DIR" -type f)

echo "✓  uploaded ${ok}, failed ${fail}"
curl -sf "${AUTH[@]}" "${BASE}/dicom-web/studies" \
  | { command -v jq >/dev/null && jq -r '.[] | "  " + (.["00100010"].Value[0].Alphabetic // "?") + "  " + (.["00080061"].Value[0] // "?")' || cat; }
