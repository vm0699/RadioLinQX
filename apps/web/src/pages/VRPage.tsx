import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, App as AntdApp, Button, ConfigProvider, Progress, Segmented, Select, Slider, Switch, Tag, Tooltip,
  theme as antdTheme,
} from 'antd';
import { api, type SeriesSummary } from '../api/client';
import { loadFullVolume, prepareVolume } from '../vr/volumeData';
import { VRScene, AXIS_NAMES, type Axis } from '../vr/VRScene';
import { isVolumetric, useXRSupport, vrUrl } from '../vr/xr';

const DARK = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#3B82F6',
    colorBgBase: '#0B1220',
    colorBgLayout: '#0E1626',
    borderRadius: 8,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};

export function VRPage() {
  return (
    <ConfigProvider theme={DARK}>
      <AntdApp style={{ height: '100%' }}>
        <VRInner />
      </AntdApp>
    </ConfigProvider>
  );
}

function VRInner() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const caseId = params.get('case') ?? '';
  const studyUid = params.get('study') ?? '';
  const seriesParam = params.get('series') ?? '';
  const xr = useXRSupport();

  // DEV only: `&emulateXR=1` installs a software Quest 3 (IWER) so the whole WebXR
  // path can be exercised without a headset. Dead-code-eliminated in production.
  useEffect(() => {
    if (import.meta.env.DEV && params.has('emulateXR')) {
      void import('../vr/emulator').then(() => window.dispatchEvent(new Event('xr-emulator-ready')));
    }
  }, [params]);

  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<VRScene | null>(null);
  const [progress, setProgress] = useState<{ f: number; label: string } | null>({ f: 0, label: 'Starting…' });
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [seriesUid, setSeriesUid] = useState('');

  // ---- load → prepare → scene ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let made: VRScene | null = null;
    setScene(null);
    setError(null);
    setProgress({ f: 0, label: 'Starting…' });

    (async () => {
      try {
        if (!studyUid) throw new Error('Missing study in the URL.');
        const all = await api.listSeriesFor(studyUid);
        const wanted = new Set(seriesParam.split(',').filter(Boolean));
        const candidates = all
          .filter((s) => isVolumetric(s) && (wanted.size === 0 || wanted.has(s.seriesInstanceUid)))
          .sort((a, b) => (b.instanceCount ?? 0) - (a.instanceCount ?? 0));
        const volumetric = all.filter(isVolumetric);
        if (!cancelled) setSeriesList(volumetric);
        const chosen = candidates[0] ?? volumetric[0];
        if (!chosen) throw new Error('This study has no series that can be shown as a 3D volume (needs a multi-slice CT/MR/PET series).');
        if (!cancelled) setSeriesUid(chosen.seriesInstanceUid);

        let patient = '';
        if (caseId) {
          try {
            patient = (await api.getCase(caseId)).patientName;
          } catch {
            /* header only */
          }
        }
        const label = chosen.seriesDescription || chosen.modality || 'Series';
        const headline = [patient, label].filter(Boolean).join(' · ');
        if (!cancelled) setTitle(headline);

        const full = await loadFullVolume(studyUid, chosen.seriesInstanceUid, (f, l) => !cancelled && setProgress({ f, label: l }));
        if (cancelled) return;
        const prepared = await prepareVolume(full, 256, (f, l) => !cancelled && setProgress({ f, label: l }));
        if (cancelled || !hostRef.current) return;
        setProgress({ f: 0.97, label: 'Starting renderer…' });
        await new Promise((r) => setTimeout(r, 20));
        made = new VRScene(hostRef.current, prepared, {
          title: headline || 'Scan',
          baseName: (caseId || chosen.seriesInstanceUid.slice(-8)).replace(/[^\w-]+/g, '_'),
        });
        if (import.meta.env.DEV) (window as unknown as { __vr: VRScene }).__vr = made;
        setScene(made);
        setProgress(null);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || String(e));
          setProgress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [studyUid, seriesParam, caseId]);

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(caseId ? `/?case=${caseId}` : '/');
  };

  const enter = async (kind: 'vr' | 'ar') => {
    if (!scene) return;
    try {
      await scene.enterXR(kind);
    } catch (e) {
      message.error(`Could not start ${kind.toUpperCase()}: ${(e as Error).message || e}`);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('Link copied — open it in the headset browser.');
    } catch {
      message.info(window.location.href);
    }
  };

  const secure = window.isSecureContext;

  return (
    <div className="viewer-shell vr-shell">
      <div className="viewer-topbar">
        <span className="brand"><span className="brand-dot" />RadBridge</span>
        <Button size="small" onClick={back}>← Back</Button>
        <span className="vr-title">{title || 'VR / 3D'}</span>
        {seriesList.length > 1 && (
          <Select
            size="small"
            value={seriesUid}
            style={{ width: 220 }}
            onChange={(v) => navigate(vrUrl(caseId, studyUid, v), { replace: true })}
            options={seriesList.map((s) => ({
              value: s.seriesInstanceUid,
              label: `${s.modality ?? ''} ${s.seriesDescription ?? ''} (${s.instanceCount})`,
            }))}
          />
        )}
        <div className="spacer" />
        <XRChip xr={xr} secure={secure} />
        <Tooltip title="Copy this page's link to open it on a headset browser">
          <Button size="small" onClick={copyLink}>Send to headset</Button>
        </Tooltip>
        {xr.ar && (
          <Button size="small" disabled={!scene} onClick={() => enter('ar')}>
            Enter AR
          </Button>
        )}
        <Button
          size="small"
          type="primary"
          disabled={!scene || !xr.vr}
          onClick={() => enter('vr')}
        >
          Enter VR
        </Button>
      </div>

      <div className="vr-body">
        <aside className="vr-side">{scene ? <Controls scene={scene} /> : <SideSkeleton error={error} />}</aside>
        <main className="vr-stage">
          <div ref={hostRef} className="vr-canvas" />
          {scene && <Overlay scene={scene} />}
          {progress && (
            <div className="vr-loading">
              <div className="vr-loading-card">
                <div className="vr-loading-title">Preparing 3D volume</div>
                <Progress percent={Math.round(progress.f * 100)} status="active" />
                <div className="dim">{progress.label}</div>
              </div>
            </div>
          )}
          {error && (
            <div className="vr-loading">
              <div className="vr-loading-card">
                <Alert type="error" showIcon message="Couldn't open the 3D view" description={error} />
                <Button style={{ marginTop: 12 }} onClick={back}>Back</Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function XRChip({ xr, secure }: { xr: ReturnType<typeof useXRSupport>; secure: boolean }) {
  if (!xr.checked) return <Tag>checking VR…</Tag>;
  if (xr.vr) return <Tag color="success">● VR headset ready</Tag>;
  if (!secure) return <Tag color="warning">VR needs HTTPS</Tag>;
  if (!xr.available) return <Tag>No WebXR in this browser</Tag>;
  return <Tag color="default">No headset detected</Tag>;
}

function SideSkeleton({ error }: { error: string | null }) {
  return <div className="dim" style={{ padding: 16 }}>{error ? 'Not available.' : 'Loading controls…'}</div>;
}

// ---------------------------------------------------------------------------
// Overlay (probe + ruler read-out)
// ---------------------------------------------------------------------------

function Overlay({ scene }: { scene: VRScene }) {
  const { state, info } = useSyncExternalStore(scene.subscribe, scene.getSnapshot);
  return (
    <>
      <div className="vr-hud">
        {info.probe ? (
          <>
            <b>{info.probe.value.toFixed(scene.volume.isCT ? 0 : 1)}</b> {scene.unitLabel}
            <span className="dim">
              {'  '}({info.probe.x.toFixed(0)}, {info.probe.y.toFixed(0)}, {info.probe.z.toFixed(0)}) mm
            </span>
          </>
        ) : (
          <span className="dim">Hover the scan to read values</span>
        )}
        {info.measurements.length > 0 && (
          <div className="vr-hud-ruler">
            {info.measurements.slice(-3).map((m, i) => (
              <span key={i}>📏 {m.mm.toFixed(1)} mm</span>
            ))}
          </div>
        )}
        {state.measure && (
          <div className="vr-hud-ruler">{info.pendingPoint ? 'Click the second point' : 'Ruler: click two points on the scan'}</div>
        )}
      </div>
      {info.busy && <div className="vr-busy">{info.busy}</div>}
      <div className="vr-hint">Drag to orbit · scroll to zoom · right-drag to pan</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="vr-row">
      <span className="vr-row-label">{label}</span>
      <div className="vr-row-ctl">{children}</div>
    </div>
  );
}

function Controls({ scene }: { scene: VRScene }) {
  const { message } = AntdApp.useApp();
  const { state: s, info } = useSyncExternalStore(scene.subscribe, scene.getSnapshot);
  const { lo, hi } = scene.range;
  const u = scene.unitLabel;
  const busy = !!info.busy;

  const axisOptions = AXIS_NAMES.map((n, i) => ({ value: i, label: n }));

  const shot = () => {
    const url = scene.capturePNG();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radbridge-3d.png';
    a.click();
  };

  const doExport = async (kind: 'glb' | 'usdz' | 'stl' | 'nii') => {
    if (kind === 'nii') await scene.exportVolume();
    else await scene.exportMesh(kind);
    if (!scene.info.error) message.success('Export ready — check your downloads.');
  };

  return (
    <div className="vr-controls">
      <section>
        <h4>View</h4>
        <Segmented
          block
          value={s.mode}
          onChange={(v) => scene.setState({ mode: v as 'volume' | 'surface' | 'slice' })}
          options={[
            { label: 'Volume', value: 'volume' },
            { label: 'Surface', value: 'surface' },
            { label: 'Slice', value: 'slice' },
          ]}
        />
        <Row label="Preset">
          <Select
            size="small"
            style={{ width: '100%' }}
            value={s.presetId}
            onChange={(v) => scene.setPreset(v)}
            options={scene.presets.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Row>
        <Row label={`Window (${u})`}>
          <Slider min={1} max={hi - lo} step={1} value={Math.min(s.width, hi - lo)} onChange={(v) => scene.setState({ width: v })} />
        </Row>
        <Row label={`Level (${u})`}>
          <Slider min={lo} max={hi} step={1} value={s.center} onChange={(v) => scene.setState({ center: v })} />
        </Row>
        <Row label="Density">
          <Slider min={0.1} max={4} step={0.05} value={s.density} disabled={s.mode === 'slice'} onChange={(v) => scene.setState({ density: v })} />
        </Row>
        {s.mode === 'surface' && (
          <Row label={`Surface level (${u})`}>
            <Slider min={lo} max={hi} step={1} value={s.iso} onChange={(v) => scene.setState({ iso: v })} />
          </Row>
        )}
        {s.mode === 'surface' && info.surface && (
          <div className="dim">{info.surface.triangles.toLocaleString()} triangles</div>
        )}
        <Row label="Quality">
          <Segmented
            size="small"
            value={s.quality}
            onChange={(v) => scene.setState({ quality: v as 'low' | 'medium' | 'high' })}
            options={[
              { label: 'Low', value: 'low' },
              { label: 'Med', value: 'medium' },
              { label: 'High', value: 'high' },
            ]}
          />
        </Row>
        <div className="vr-switches">
          <label><Switch size="small" checked={s.lighting} onChange={(v) => scene.setState({ lighting: v })} /> Lighting</label>
          <label><Switch size="small" checked={s.mip} disabled={s.mode !== 'volume'} onChange={(v) => scene.setState({ mip: v })} /> MIP</label>
        </div>
      </section>

      <section>
        <h4>Cut &amp; slice</h4>
        <Row label="Clip plane">
          <Switch size="small" checked={s.clipOn} onChange={(v) => scene.setState({ clipOn: v })} />
        </Row>
        {s.clipOn && (
          <>
            <Select size="small" style={{ width: '100%', marginBottom: 6 }} value={s.clipAxis} onChange={(v: Axis) => scene.setState({ clipAxis: v })} options={axisOptions} />
            <Slider min={0} max={1} step={0.005} value={s.clipPos} tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }} onChange={(v) => scene.setState({ clipPos: v })} />
            <label className="vr-inline"><Switch size="small" checked={s.clipFlip} onChange={(v) => scene.setState({ clipFlip: v })} /> Flip side</label>
          </>
        )}
        <Row label="MPR plane">
          <Switch size="small" checked={s.showSlice || s.mode === 'slice'} disabled={s.mode !== 'volume'} onChange={(v) => scene.setState({ showSlice: v })} />
        </Row>
        {(s.showSlice || s.mode === 'slice') && (
          <>
            <Select size="small" style={{ width: '100%', marginBottom: 6 }} value={s.sliceAxis} onChange={(v: Axis) => scene.setState({ sliceAxis: v })} options={axisOptions} />
            <Slider min={0} max={1} step={0.002} value={s.slicePos} tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }} onChange={(v) => scene.setState({ slicePos: v })} />
          </>
        )}
      </section>

      <section>
        <h4>Measure</h4>
        <div className="vr-switches">
          <label><Switch size="small" checked={s.measure} onChange={(v) => scene.setState({ measure: v })} /> Ruler (2 clicks)</label>
        </div>
        <div className="vr-btnrow">
          <Button size="small" onClick={() => scene.clearMeasurements()} disabled={!info.measurements.length && !info.pendingPoint}>Clear ruler</Button>
          <Button size="small" onClick={() => scene.resetView()}>Reset view</Button>
          <Button size="small" onClick={shot}>PNG</Button>
        </div>
      </section>

      <section>
        <h4>Convert &amp; export</h4>
        <div className="vr-export">
          <Tooltip title="Polygon mesh for Quest / Blender / web viewers (metres, Y-up)">
            <Button size="small" disabled={busy} onClick={() => doExport('glb')}>3D model · GLB</Button>
          </Tooltip>
          <Tooltip title="Apple Vision Pro / iPhone AR Quick Look">
            <Button size="small" disabled={busy} onClick={() => doExport('usdz')}>Apple AR · USDZ</Button>
          </Tooltip>
          <Tooltip title="Millimetres, patient orientation — for 3D printing / CAD">
            <Button size="small" disabled={busy} onClick={() => doExport('stl')}>3D print · STL</Button>
          </Tooltip>
          <Tooltip title="Full-resolution voxel volume for 3D Slicer, ITK-SNAP, FSL">
            <Button size="small" disabled={busy} onClick={() => doExport('nii')}>Volume · NIfTI</Button>
          </Tooltip>
        </div>
        <div className="dim" style={{ marginTop: 6 }}>
          Meshes use the current <b>Surface level</b> ({Math.round(s.iso)} {u}) and preset colour.
        </div>
      </section>

      {info.error && <Alert type="error" showIcon message={info.error} style={{ marginTop: 8 }} />}

      <section>
        <h4>In the headset</h4>
        <ul className="vr-help">
          <li><b>Grip</b> grabs &amp; moves the scan; <b>both grips</b> scale + rotate</li>
          <li><b>Trigger</b> clicks the tablet / places ruler points</li>
          <li><b>Right stick</b> window / level · <b>Left stick</b> clip / slice &amp; density</li>
          <li><b>A</b> panel · <b>B</b> reset · <b>X</b> ruler · <b>Y</b> next preset</li>
          <li>Hands: <b>pinch</b> to grab or click</li>
        </ul>
      </section>
    </div>
  );
}
