import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Button, Tooltip } from 'antd';
import { initCornerstone } from '../dicom/cornerstoneInit';
import { getSeriesImageIds } from '../dicom/imageIds';
import { api } from '../api/client';
import { useViewer, type LoadedSeries } from '../viewer/store';
import { registerTools, ensureToolGroup, resolveToolName } from '../viewer/tools';
import { Toolbar } from '../viewer/Toolbar';
import { SeriesPanel } from '../viewer/SeriesPanel';
import { ViewerGrid } from '../viewer/ViewerGrid';
import * as csTools from '@cornerstonejs/tools';

export function ViewerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const studyUid = params.get('study') ?? '';
  const seriesCsv = params.get('series') ?? '';

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootRef = useRef(false);

  const store = useViewer();

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;

    (async () => {
      try {
        await initCornerstone();
        registerTools();
        ensureToolGroup();

        if (!studyUid || !seriesCsv) {
          setError('Missing study or series in the URL.');
          return;
        }

        const wanted = new Set(seriesCsv.split(',').filter(Boolean));
        const allSeries = await api.listSeries(studyUid);
        const chosen = allSeries.filter((s) => wanted.has(s.seriesInstanceUid));
        if (chosen.length === 0) {
          setError('None of the requested series were found.');
          return;
        }

        const loaded: LoadedSeries[] = [];
        for (const s of chosen) {
          const { imageIds } = await getSeriesImageIds(studyUid, s.seriesInstanceUid);
          loaded.push({ ...s, studyInstanceUid: studyUid, imageIds });
        }

        // patient/study header from the first study row
        const studyRow = (await api.listStudies({ StudyInstanceUID: studyUid }))[0];

        useViewer.setState({
          studyInstanceUid: studyUid,
          patient: {
            name: studyRow?.patientName,
            id: studyRow?.patientId,
            sex: studyRow?.patientSex,
            birthDate: studyRow?.patientBirthDate,
            studyDescription: studyRow?.studyDescription,
            studyDate: studyRow?.studyDate,
          },
          series: loaded,
          layout: { rows: 1, cols: 1 },
          assignments: [loaded[0]?.seriesInstanceUid],
          activeViewportIndex: 0,
        });

        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [studyUid, seriesCsv]);

  // Crosshairs / ReferenceLines toggles. Crosshairs needs >= 2 viewports, so it
  // only makes sense once MPR is active and the 3 ortho viewports are attached.
  useEffect(() => {
    const group = ensureToolGroup();
    const cross = resolveToolName('Crosshairs');
    const ref = resolveToolName('ReferenceLines');
    const viewportCount = group.getViewportIds?.().length ?? 0;
    try {
      if (cross) {
        if (store.crosshairs && store.mpr && viewportCount >= 2) {
          group.setToolActive(cross, {
            bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
          });
        } else {
          group.setToolPassive(cross);
        }
      }
      if (ref) {
        store.referenceLines && viewportCount >= 2
          ? group.setToolEnabled(ref)
          : group.setToolDisabled(ref);
      }
    } catch {
      /* ignore */
    }
  }, [store.crosshairs, store.referenceLines, store.mpr, ready]);

  if (error) {
    return (
      <div className="viewer-shell">
        <div className="viewer-topbar">
          <span className="brand">radiolinq</span>
          <Button size="small" onClick={() => navigate('/')}>
            Back to studies
          </Button>
        </div>
        <div className="viewer-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <div className="viewer-topbar">
        <span className="brand">radiolinq</span>
        <Tooltip title="Reload series">
          <Button
            size="small"
            onClick={() => window.location.reload()}
          >
            ⟳ Refresh
          </Button>
        </Tooltip>
        <div className="spacer" />
        <Tooltip title="Clinical history (from referring doctor) — no data">
          <Button size="small">Clinical history</Button>
        </Tooltip>
      </div>

      {!ready ? (
        <div className="viewer-loading">
          <Spin size="large" />
          <span style={{ marginLeft: 12 }}>Loading study…</span>
        </div>
      ) : (
        <>
          <Toolbar />
          <div className="viewer-body">
            <SeriesPanel />
            <ViewerGrid />
          </div>
        </>
      )}
    </div>
  );
}
