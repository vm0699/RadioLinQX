import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, App as AntdApp, Button, Collapse, ConfigProvider, Input, Progress, Segmented, Select, Slider, Switch, Tag, Tooltip,
  theme as antdTheme,
} from 'antd';
import type { NameScheme } from '../vr/segNames';
import { api, type SeriesSummary } from '../api/client';
import { loadFullVolume, prepareVolume } from '../vr/volumeData';
import { VRScene, AXIS_NAMES, type Axis, type SegPersist } from '../vr/VRScene';
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
  // orbit angle of the scene being replaced — a new series of the same study opens at the same angle
  const carryView = useRef<{ study: string; view: { cam: number[]; target: number[] } } | null>(null);

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
        const listed = await api.listSeriesFor(studyUid);
        // list the series in the case's preferred order (its default 3D series first)
        let pref: string[] = [];
        if (caseId) {
          try {
            pref = (await api.getCase(caseId)).seriesInstanceUids ?? [];
          } catch {
            /* keep the study's own order */
          }
        }
        const rank = (uid: string) => (pref.includes(uid) ? pref.indexOf(uid) : pref.length);
        const all = [...listed].sort((a, b) => rank(a.seriesInstanceUid) - rank(b.seriesInstanceUid));
        const wanted = new Set(seriesParam.split(',').filter(Boolean));
        const pool = all.filter((x) => wanted.size === 0 || wanted.has(x.seriesInstanceUid));
        const biggest = (arr: SeriesSummary[]) =>
          [...arr].sort((a, b) => (b.instanceCount ?? 0) - (a.instanceCount ?? 0))[0];
        // prefer a real 3D volume; otherwise show the 2D series as a virtual screen
        const chosen =
          biggest(pool.filter(isVolumetric)) ?? biggest(pool) ?? biggest(all.filter(isVolumetric)) ?? biggest(all);
        if (!cancelled) setSeriesList(all);
        if (!chosen) throw new Error('This study has no images.');
        if (!cancelled) setSeriesUid(chosen.seriesInstanceUid);
        const stack = !isVolumetric(chosen);

        let patient = '';
        if (caseId) {
          try {
            patient = (await api.getCase(caseId)).patientName;
          } catch {
            /* header only */
          }
        }
        const label =
          (chosen.seriesNumber != null && chosen.seriesDescription ? `#${chosen.seriesNumber} ` : '') +
          (chosen.seriesDescription || chosen.modality || 'Series');
        const headline = [patient, label].filter(Boolean).join(' · ');
        if (!cancelled) setTitle(headline);

        const full = await loadFullVolume(
          studyUid,
          chosen.seriesInstanceUid,
          (f, l) => !cancelled && setProgress({ f, label: l }),
          { stack, modality: chosen.modality },
        );
        if (cancelled) return;
        // 2D series: keep as much in-plane resolution as memory allows
        const maxDim = stack ? Math.max(192, Math.min(512, Math.floor(Math.sqrt(48e6 / Math.max(2, full.frames))))) : 256;
        const prepared = await prepareVolume(full, maxDim, (f, l) => !cancelled && setProgress({ f, label: l }));
        if (cancelled || !hostRef.current) return;
        setProgress({ f: 0.97, label: 'Starting renderer…' });
        await new Promise((r) => setTimeout(r, 20));
        const persist: SegPersist | undefined = caseId
          ? {
              exists: async () => (await api.segmentationInfo(caseId)).exists,
              load: async () => {
                const info = await api.segmentationInfo(caseId);
                if (!info.exists) return null;
                const file = await api.segmentationFile(caseId);
                return file ? { file, meta: info.meta } : null;
              },
              save: (file, meta) => api.saveSegmentation(caseId, file, meta),
              remove: async () => {
                await api.deleteSegmentation(caseId);
              },
            }
          : undefined;
        made = new VRScene(hostRef.current, prepared, {
          title: headline || 'Scan',
          baseName: (caseId || chosen.seriesInstanceUid.slice(-8)).replace(/[^\w-]+/g, '_'),
          seriesUid: chosen.seriesInstanceUid,
          persist,
        });
        if (carryView.current?.study === studyUid) made.setView(carryView.current.view);
        if (!made.isStack) void made.segInit();
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
      const view = made?.getView();
      if (view) carryView.current = { study: studyUid, view };
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
        <span className="brand"><span className="brand-dot" />WeScan</span>
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
              label: `${s.modality ?? ''} ${s.seriesDescription ?? ''} (${s.instanceCount})${isVolumetric(s) ? '' : ' · 2D'}`,
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
        <aside className="vr-side">
          {seriesList.length > 1 && (
            <SeriesList
              list={seriesList}
              current={seriesUid}
              onPick={(uid) => navigate(vrUrl(caseId, studyUid, uid), { replace: true })}
            />
          )}
          {scene ? (scene.isStack ? <StackControls scene={scene} /> : <Controls scene={scene} />) : <SideSkeleton error={error} />}
        </aside>
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

/** Every series of the study — pick one to view it in 3D; the viewing angle carries over. */
function SeriesList({
  list,
  current,
  onPick,
}: {
  list: SeriesSummary[];
  current: string;
  onPick: (uid: string) => void;
}) {
  return (
    <section className="vr-series">
      <h4>Series · {list.length}</h4>
      <div className="vr-series-list">
        {list.map((s) => {
          const vol = isVolumetric(s);
          return (
            <button
              key={s.seriesInstanceUid}
              className={`vr-series-item${s.seriesInstanceUid === current ? ' active' : ''}`}
              onClick={() => s.seriesInstanceUid !== current && onPick(s.seriesInstanceUid)}
              title={s.seriesDescription ?? ''}
            >
              <span className="vr-series-mod">{s.modality ?? '—'}</span>
              <span className="vr-series-text">
                <span className="vr-series-name">{s.seriesDescription?.trim() || `Series ${s.seriesNumber ?? ''}`}</span>
                <span className="dim">
                  {s.seriesNumber != null ? `#${s.seriesNumber} · ` : ''}
                  {s.instanceCount} {s.instanceCount === 1 ? 'image' : 'slices'} · {vol ? '3D volume' : '2D screen'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
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
              {'  '}({info.probe.x.toFixed(0)}, {info.probe.y.toFixed(0)}{scene.isStack ? '' : `, ${info.probe.z.toFixed(0)}`}) {scene.lenUnit}
            </span>
          </>
        ) : (
          <span className="dim">Hover the scan to read values</span>
        )}
        {info.measurements.length > 0 && (
          <div className="vr-hud-ruler">
            {info.measurements.slice(-3).map((m, i) => (
              <span key={i}>📏 {m.mm.toFixed(1)} {scene.lenUnit}</span>
            ))}
          </div>
        )}
        {state.measure && (
          <div className="vr-hud-ruler">{info.pendingPoint ? 'Click the second point' : 'Ruler: click two points on the scan'}</div>
        )}
      </div>
      {info.busy && <div className="vr-busy">{info.busy}</div>}
      <div className="vr-hint">
        {scene.isStack
          ? 'Scroll / ← → change frame · Space play · Ctrl+scroll zoom · drag to orbit'
          : 'Drag to orbit · scroll to zoom · right-drag to pan'}
      </div>
      {scene.isStack && scene.frameCount > 1 && (
        <div className="vr-framebadge">Frame {state.frame + 1} / {scene.frameCount}</div>
      )}
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
    a.download = 'wescan-3d.png';
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

      <SegSection scene={scene} />

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

// ---------------------------------------------------------------------------
// Segmentation (hide organs)
// ---------------------------------------------------------------------------

const TOOL_HINT: Record<string, string> = {
  off: 'Pick a tool, then click the scan.',
  hide: 'Click a structure to hide it (click again to show). On un-segmented areas it grows a region and hides that.',
  grow: 'Click to grow a region from that point (same tissue, connected). Raise Leak control if it bleeds into neighbours.',
  carve: 'Drag over the scan to cut it away with a brush. Right-drag to orbit.',
};

function SegSection({ scene }: { scene: VRScene }) {
  const { state: s, info } = useSyncExternalStore(scene.subscribe, scene.getSnapshot);
  const seg = info.seg;
  const [scheme, setScheme] = useState<NameScheme | 'auto'>('auto');
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = !!info.busy;
  const u = scene.unitLabel;
  const tolMax = scene.volume.isCT ? 400 : Math.max(2, (scene.volume.p99 - scene.volume.p2) * 0.6);
  const byGroup = new Map<string, typeof seg.labels>();
  for (const l of seg.labels) byGroup.set(l.group, [...(byGroup.get(l.group) ?? []), l]);

  return (
    <section>
      <h4>Segment · hide organs</h4>
      <Segmented
        block
        value={s.segTool}
        onChange={(v) => scene.setState({ segTool: v as typeof s.segTool })}
        options={[
          { label: 'Off', value: 'off' },
          { label: 'Hide', value: 'hide' },
          { label: 'Grow', value: 'grow' },
          { label: 'Carve', value: 'carve' },
        ]}
      />
      <div className="dim" style={{ margin: '6px 0 2px' }}>{TOOL_HINT[s.segTool]}</div>
      {(s.segTool === 'grow' || s.segTool === 'hide') && (
        <>
          <Row label={`Tolerance ± ${Math.round(s.segTol)} ${u}`}>
            <Slider min={1} max={tolMax} step={1} value={Math.min(s.segTol, tolMax)} onChange={(v) => scene.setState({ segTol: v })} />
          </Row>
          <Row label={`Leak control ${s.segLeak}`}>
            <Slider min={0} max={3} step={1} value={s.segLeak} onChange={(v) => scene.setState({ segLeak: v })} />
          </Row>
        </>
      )}
      {s.segTool === 'carve' && (
        <Row label={`Brush ${Math.round(s.brushMm)} mm`}>
          <Slider min={2} max={Math.max(10, Math.round(scene.volume.sizeMm[0] * 0.2))} step={1} value={s.brushMm} onChange={(v) => scene.setState({ brushMm: v })} />
        </Row>
      )}
      <div className="vr-switches">
        <label><Switch size="small" checked={s.segAutoHide} onChange={(v) => scene.setState({ segAutoHide: v })} /> Hide new regions</label>
        <label><Switch size="small" checked={s.segMargin} onChange={(v) => scene.setState({ segMargin: v })} /> Soft edge</label>
      </div>
      <div className="vr-btnrow">
        <Button size="small" type="primary" disabled={busy} onClick={() => void scene.segAuto()}>Auto-segment</Button>
        <Button size="small" disabled={!seg.canUndo} onClick={() => scene.segUndo()}>Undo</Button>
        <Button size="small" disabled={!seg.hasHidden} onClick={() => scene.segShowAll()}>Show all</Button>
        <Button size="small" danger disabled={!seg.labels.length} onClick={() => scene.segClear()}>Clear</Button>
      </div>

      <div className="vr-row">
        <span className="vr-row-label">Organ label map (NIfTI from TotalSegmentator / 3D Slicer)</span>
        <div className="vr-btnrow" style={{ marginTop: 4 }}>
          <Select
            size="small"
            style={{ width: 150 }}
            value={scheme}
            onChange={setScheme}
            options={[
              { value: 'auto', label: 'Names: auto' },
              { value: 'totalseg', label: 'TotalSegmentator' },
              { value: 'generic', label: 'Generic' },
            ]}
          />
          <Button size="small" disabled={busy} onClick={() => fileRef.current?.click()}>Import .nii / .nii.gz</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".nii,.gz,.nii.gz,application/gzip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scene.segImportFile(f, scheme);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {seg.note && <Alert style={{ marginTop: 8 }} type="info" showIcon message={seg.note} />}

      {seg.labels.length > 0 && (
        <Collapse
          size="small"
          style={{ marginTop: 10 }}
          items={[...byGroup.entries()].map(([group, labels]) => {
            const g = seg.groups.find((x) => x.name === group);
            const anyShown = labels.some((l) => l.visible);
            return {
              key: group,
              label: (
                <span className="seg-group">
                  <Switch
                    size="small"
                    checked={anyShown}
                    onClick={(_v, e) => e.stopPropagation()}
                    onChange={() => scene.segToggleGroup(group)}
                  />
                  <b>{group}</b>
                  <span className="dim">{labels.length} · {Math.round(g?.ml ?? 0).toLocaleString()} mL</span>
                </span>
              ),
              children: labels.map((l) => (
                <div key={l.id} className={`seg-row${seg.selected === l.id ? ' sel' : ''}`}>
                  <Switch size="small" checked={l.visible} onChange={() => scene.segToggle(l.id)} />
                  <span className="seg-dot" style={{ background: `rgb(${l.color.map((c) => Math.round(c * 255)).join(',')})` }} />
                  <Input
                    size="small"
                    variant="borderless"
                    defaultValue={l.name}
                    onBlur={(e) => scene.segRename(l.id, e.target.value)}
                    onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                  />
                  <span className="dim seg-ml">{l.ml >= 10 ? Math.round(l.ml) : l.ml.toFixed(1)} mL</span>
                  <Tooltip title="Solo (show only this)"><Button size="small" type="text" onClick={() => scene.segIsolate(l.id)}>◎</Button></Tooltip>
                  <Tooltip title="Highlight"><Button size="small" type="text" onClick={() => scene.segSelect(l.id)}>◍</Button></Tooltip>
                  <Tooltip title="Delete"><Button size="small" type="text" danger onClick={() => scene.segRemove(l.id)}>✕</Button></Tooltip>
                </div>
              )),
            };
          })}
        />
      )}

      <div className="vr-btnrow" style={{ marginTop: 10 }}>
        <Button size="small" disabled={busy || !seg.labels.length || !scene.hasPersist} onClick={() => void scene.segSave()}>Save to case</Button>
        <Button size="small" disabled={busy || !scene.hasPersist || seg.serverHas === false} onClick={() => void scene.segLoad()}>Load saved</Button>
        <Button size="small" disabled={busy || !seg.labels.length} onClick={() => void scene.segExport()}>Labels .nii.gz</Button>
        {seg.serverHas && scene.hasPersist && (
          <Button size="small" danger disabled={busy} onClick={() => void scene.segDeleteSaved()}>Delete saved</Button>
        )}
      </div>
      {scene.hasPersist && (
        <div className="dim" style={{ marginTop: 4 }}>
          {seg.serverHas ? '● A segmentation is saved for this case.' : 'Save once — it loads automatically in every headset.'}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2D series (XA cine, ultrasound, X-ray …) as a virtual screen
// ---------------------------------------------------------------------------

function StackControls({ scene }: { scene: VRScene }) {
  const { state: s, info } = useSyncExternalStore(scene.subscribe, scene.getSnapshot);
  const { lo, hi } = scene.range;
  const u = scene.unitLabel;
  const n = scene.frameCount;
  const shot = () => {
    const url = scene.capturePNG();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wescan-2d.png';
    a.click();
  };
  return (
    <div className="vr-controls">
      <section>
        <h4>2D series · virtual screen</h4>
        <div className="dim">
          {n} frame{n === 1 ? '' : 's'} · {scene.volume.full.calibrated ? 'calibrated (mm)' : 'uncalibrated — distances in pixels'}
        </div>
        {n > 1 && (
          <>
            <Row label={`Frame ${s.frame + 1} / ${n}`}>
              <Slider min={0} max={n - 1} step={1} value={s.frame} onChange={(v) => scene.setFrame(v)} />
            </Row>
            <div className="vr-btnrow">
              <Button size="small" onClick={() => scene.stepFrame(-1)}>◀</Button>
              <Button size="small" type={s.playing ? 'primary' : 'default'} onClick={() => scene.togglePlay()}>
                {s.playing ? 'Pause' : 'Play'}
              </Button>
              <Button size="small" onClick={() => scene.stepFrame(1)}>▶</Button>
            </div>
            <Row label={`Speed ${s.fps} fps`}>
              <Slider min={1} max={30} step={1} value={s.fps} onChange={(v) => scene.setState({ fps: v })} />
            </Row>
          </>
        )}
        <Row label={`Window (${u})`}>
          <Slider min={1} max={hi - lo} step={1} value={Math.min(s.width, hi - lo)} onChange={(v) => scene.setState({ width: v })} />
        </Row>
        <Row label={`Level (${u})`}>
          <Slider min={lo} max={hi} step={1} value={s.center} onChange={(v) => scene.setState({ center: v })} />
        </Row>
        <div className="vr-switches">
          <label><Switch size="small" checked={s.invert} onChange={(v) => scene.setState({ invert: v })} /> Invert</label>
          <label><Switch size="small" checked={s.measure} onChange={(v) => scene.setState({ measure: v })} /> Ruler (2 clicks)</label>
        </div>
        <div className="vr-btnrow">
          <Button size="small" onClick={() => scene.clearMeasurements()} disabled={!info.measurements.length && !info.pendingPoint}>Clear ruler</Button>
          <Button size="small" onClick={() => scene.resetView()}>Reset view</Button>
          <Button size="small" onClick={shot}>PNG</Button>
        </div>
      </section>
      {info.error && <Alert type="error" showIcon message={info.error} style={{ marginBottom: 8 }} />}
      <section>
        <h4>In the headset</h4>
        <ul className="vr-help">
          <li><b>Left stick</b> scroll frames · <b>Right stick</b> window / level</li>
          <li><b>Grip</b> moves the screen; <b>both grips</b> scale it</li>
          <li><b>Trigger</b> clicks the tablet · places ruler points</li>
          <li><b>A</b> panel · <b>B</b> reset · <b>X</b> ruler</li>
        </ul>
        <div className="dim">
          This is a 2D series, so it is shown on a floating screen. CT / MR / PET series open as a full 3D volume.
        </div>
      </section>
    </div>
  );
}
