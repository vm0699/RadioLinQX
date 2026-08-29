#!/usr/bin/env bash
# Upload every DICOM under sample-data/ into Orthanc via STOW-RS.
# If sample-data/ has no DICOM files, download a small public CT series first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

ORTHANC_HTTP_PORT="${ORTHANC_HTTP_PORT:-8042}"
ORTHANC_USERNAME="${ORTHANC_USERNAME:-radiolinq}"
ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-change-me-orthanc}"
BASE="http://localhost:${ORTHANC_HTTP_PORT}"
AUTH="-u ${ORTHANC_USERNAME}:${ORTHANC_PASSWORD}"

echo "▶ Checking Orthanc at ${BASE} ..."
until curl -sf $AUTH "${BASE}/system" >/dev/null; do
  echo "  waiting for Orthanc..."; sleep 2
done
echo "✓ Orthanc is up"

SAMPLE_DIR="sample-data"
mapfile -t FILES < <(find "$SAMPLE_DIR" -type f \( -iname '*.dcm' -o -iname '*.dicom' -o ! -iname '*.*' \) 2>/dev/null || true)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "ℹ No DICOM files in ${SAMPLE_DIR}/ — fetching a public sample CT series..."
  TMP="$(mktemp -d)"
  # Cornerstone3D demo data: a compact CT volume (~30 MB), no PHI.
  URL="https github.com/cornerstonejs/cornerstone3D/raw/main/packages/docs/static/viewports.zip"
  # Fallback list of individual sample files hosted by the OHIF project.
  for i in $(seq -w 1 20); do
    curl -sfL "https://raw.githubusercontent.com/cornerstonejs/cornerstoneTools/master/test/image_${i}.dcm" \
      -o "${TMP}/image_${i}.dcm" 2>/dev/null || true
  done
  mapfile -t FILES < <(find "$TMP" -type f -size +1k)
  if [ "${#FILES[@]}" -eq 0 ]; then
    cat <<'EOF'

✗ Could not download public sample data (offline?).
  Put a few .dcm files (a multi-slice CT or MR series is ideal) into sample-data/
  and re-run this script.
EOF
    exit 1
  fi
fi

echo "▶ Uploading ${#FILES[@]} file(s) via STOW-RS ..."
ok=0; fail=0
for f in "${FILES[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' $AUTH \
    -X POST "${BASE}/dicom-web/studies" \
    -H "Content-Type: application/dicom" \
    --data-binary "@${f}")
  if [[ "$code" =~ ^20 ]]; then ok=$((ok+1)); else fail=$((fail+1)); echo "  ! $f → HTTP $code"; fi
done

echo "✓ Uploaded ${ok} file(s), ${fail} failure(s)"
echo "▶ Studies now in Orthanc:"
curl -sf $AUTH "${BASE}/dicom-web/studies" | \
  (command -v jq >/dev/null && jq -r '.[] | "  " + (.["00100010"].Value[0].Alphabetic // "?") + "  " + (.["0020000D"].Value[0] // "?")' || cat)
