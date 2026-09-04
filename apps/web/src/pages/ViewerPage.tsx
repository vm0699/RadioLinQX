import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Button, Tooltip, ConfigProvider, theme as antdTheme } from 'antd';

const DARK = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#3B82F6',
    colorBgBase: '#0B1220',
    borderRadius: 8,
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};
import { initCornerstone } from '../dicom/cornerstoneInit';
import { loadSeriesImageIds } from '../dicom/imageIds';
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
  const caseId = params.get('case') ?? '';
  const studyUid = params.get('study') ?? '';
  const seriesCsv = params.get('series') ?? '';

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clinical, setClinical] = useState<string>('');
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

        const mode = await api.getMode();
        const wanted = new Set(seriesCsv.split(',').filter(Boolean));
        const allSeries = await api.listSeriesFor(studyUid);
        const chosen = wanted.size
          ? allSeries.filter((s) => wanted.has(s.seriesInstanceUid))
          : allSeries;
        if (chosen.length === 0) {
          setError('None of the requested series were found.');
          return;
        }

        const loaded: LoadedSeries[] = [];
        for (const s of chosen) {
          const { imageIds } = await loadSeriesImageIds(
            mode,
            studyUid,
            s.seriesInstanceUid,
          );
          loaded.push({ ...s, studyInstanceUid: studyUid, imageIds });
        }

        // patient/study header — from the case when we have one
        let patient = {} as Record<string, string | undefined>;
        if (caseId) {
          try {
            const c = await api.getCase(caseId);
            patient = {
              name: c.patientName,
              id: c.patientId,
              sex: c.patientSex,
              birthDate: c.patientAge != null ? `${c.patientAge}y` : undefined,
              studyDescription: c.studyDescription,
              studyDate: c.uploadedAt?.slice(0, 10),
            };
            setClinical(c.patientHistory ?? '');
          } catch {
            /* fall through */
          }
        }

        useViewer.setState({
          studyInstanceUid: studyUid,
          patient,
          series: loaded,
          layout: { rows: 1, cols: 1 },
          assignments: [loaded[0]?.seriesInstanceUid],
          activeViewportIndex: 0,
          mpr: false,
          vrt: false,
          sync: false,
          topBarHidden: false,
        });

        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [studyUid, seriesCsv, caseId]);

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
      <ConfigProvider theme={DARK}>
        <div className="viewer-shell">
          <div className="viewer-topbar">
            <span className="brand"><span className="brand-dot" />radiolinq</span>
            <Button size="small" onClick={() => navigate('/')}>
              Back to studies
            </Button>
          </div>
          <div className="viewer-error">{error}</div>
        </div>
      </ConfigProvider>
    );
  }

  return (
   <ConfigProvider theme={DARK}>
    <div className="viewer-shell">
      <div className="viewer-topbar">
        <span className="brand"><span className="brand-dot" />radiolinq</span>
        <Tooltip title="Reload series">
          <Button
            size="small"
            onClick={() => window.location.reload()}
          >
            ⟳ Refresh
          </Button>
        </Tooltip>
        <div className="spacer" />
        <Tooltip title={clinical || 'Clinical history (from referring doctor) — no data'}>
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
          {store.topBarHidden ? (
            <button className="toolbar-peek" onClick={() => store.set('topBarHidden', false)}>
              ▾ show toolbar
            </button>
          ) : (
            <Toolbar
              onReport={() =>
                caseId ? navigate(`/?case=${caseId}`) : navigate('/')
              }
            />
          )}
          <div className="viewer-body">
            <SeriesPanel />
            <ViewerGrid />
          </div>
        </>
      )}
    </div>
   </ConfigProvider>
  );
}
