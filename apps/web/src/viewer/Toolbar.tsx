import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropdown, Slider, InputNumber, Select, Popover, Modal, Tooltip } from 'antd';
import { useViewer, type ProjectionMode, type PrimaryToolKey } from './store';
import { setPrimaryTool, MEASURE_MENU } from './tools';
import {
  rotate,
  stackViewportId,
  playCine,
  stopCine,
  captureViewportPng,
  resetAll,
  ENGINE_ID,
} from './renderingManager';
import * as csTools from '@cornerstonejs/tools';
import { getRenderingEngine } from '@cornerstonejs/core';
import { recordViewportWebM } from './videoExport';

const VRT_PRESETS = [
  'CT-Bone', 'CT-Bones', 'CT-AAA', 'CT-Cardiac', 'CT-Chest-Contrast-Enhanced',
  'CT-Chest-Vessels', 'CT-Coronary-Arteries', 'CT-Lung', 'CT-MIP',
  'CT-Muscle', 'CT-Soft-Tissue', 'MR-Default', 'MR-MIP', 'MR-Angio',
];

const SHORTCUTS: [string, string][] = [
  ['Left drag', 'active tool (W/L, Zoom, Pan, measure…)'],
  ['Right drag', 'Window / Level'],
  ['Middle drag', 'Pan'],
  ['Mouse wheel', 'scroll stack / rotate in 3D'],
  ['MPR', 'drag a crosshair to reslice the other planes'],
  ['Delete', 'clears all annotations'],
];

function TB({
  label,
  active,
  disabled,
  badge,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`tb-btn${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {badge && <span className="tb-badge">{badge}</span>}
      <span className="tb-label">{label}</span>
    </button>
  );
}

export function Toolbar({ onReport }: { onReport?: () => void }) {
  const navigate = useNavigate();
  const st = useViewer();
  const trackRef = useRef<HTMLDivElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const activeStackVp = stackViewportId(st.activeViewportIndex);
  const hasSeries = st.series.length > 0;
  const in3dOrMpr = st.mpr || st.vrt;

  const pick = (tool: PrimaryToolKey) => {
    setPrimaryTool(tool);
    st.set('primaryTool', tool);
  };

  const clearAnnotations = () => {
    try {
      (csTools.annotation.state as { removeAllAnnotations?: () => void }).removeAllAnnotations?.();
    } catch {
      /* ignore */
    }
    getRenderingEngine(ENGINE_ID)?.render();
  };

  const toggleMpr = () => {
    if (!st.mpr && st.vrt) st.set('vrt', false);
    st.set('mpr', !st.mpr);
  };
  const toggleVrt = () => {
    if (!st.vrt && st.mpr) st.set('mpr', false);
    st.set('vrt', !st.vrt);
  };

  const scrollBy = (dx: number) => trackRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  const gridPopover = (
    <div className="grid-picker">
      {[1, 2, 3].map((r) => (
        <div key={r} className="grid-row">
          {[1, 2, 3].map((c) => (
            <button
              key={c}
              className="grid-cell"
              title={`${r} × ${c}`}
              onClick={() => st.setLayout(r, c)}
            />
          ))}
        </div>
      ))}
      <div className="dim" style={{ marginTop: 6 }}>{st.layout.rows} × {st.layout.cols}</div>
    </div>
  );

  return (
    <div className="toolbar toolbar-scroll">
      <button className="tb-chevron" onClick={() => scrollBy(-300)} aria-label="scroll left">‹</button>
      <div className="tb-track" ref={trackRef}>
        <TB label="Cases" onClick={() => navigate('/')} />
        <span className="tb-sep" />

        <TB label="Stack" badge="L" onClick={() => pick('WindowLevel')} />
        <TB label="Zoom" active={st.primaryTool === 'Zoom'} onClick={() => pick('Zoom')} />
        <TB label="Pan" active={st.primaryTool === 'Pan'} onClick={() => pick('Pan')} />
        <TB label="W/L" badge="R" active={st.primaryTool === 'WindowLevel'} onClick={() => pick('WindowLevel')} />
        <TB label="Rotate" onClick={() => rotate(90)} />

        <Dropdown
          menu={{
            items: MEASURE_MENU.map((m) => ({ key: m.key, label: m.label })),
            onClick: ({ key }) => {
              const e = MEASURE_MENU.find((m) => m.key === key);
              if (e) pick(e.toolKey as PrimaryToolKey);
            },
          }}
        >
          <span><TB label="Measure ▾" active={MEASURE_MENU.some((m) => m.toolKey === st.primaryTool)} /></span>
        </Dropdown>

        <TB label="Delete" onClick={clearAnnotations} />

        <Popover content={gridPopover} trigger="click" placement="bottom">
          <span><TB label="Grid" disabled={in3dOrMpr} /></span>
        </Popover>

        <TB
          label="Localizer"
          active={st.referenceLines}
          disabled={in3dOrMpr}
          onClick={() => st.set('referenceLines', !st.referenceLines)}
        />

        <span className="tb-sep" />

        <TB label="VRT" active={st.vrt} disabled={!hasSeries} onClick={toggleVrt} />
        <TB label="MPR" active={st.mpr} disabled={!hasSeries} onClick={toggleMpr} />
        <TB label="Cross" active={st.crosshairs} disabled={!st.mpr} onClick={() => st.set('crosshairs', !st.crosshairs)} />

        <div className="tb-plane" aria-disabled={!st.mpr}>
          {(['Ax', 'Cor', 'Sag'] as const).map((p) => (
            <button key={p} className="tb-plane-btn" disabled={!st.mpr}>{p}</button>
          ))}
        </div>

        {st.vrt ? (
          <div className="tb-slab">
            <Select
              size="small"
              value={st.vrtPreset}
              onChange={(v) => st.set('vrtPreset', v)}
              style={{ width: 170 }}
              options={VRT_PRESETS.map((v) => ({ value: v, label: v }))}
            />
          </div>
        ) : (
          <div className={`tb-slab${st.mpr ? '' : ' disabled'}`}>
            <Slider
              min={0.5} max={200} step={0.5}
              value={st.slabThicknessMm}
              onChange={(v) => st.set('slabThicknessMm', v)}
              disabled={!st.mpr}
              style={{ width: 110 }}
              tooltip={{ formatter: (v) => `Slab ${v} mm` }}
            />
            <Select
              size="small"
              value={st.projection}
              disabled={!st.mpr}
              onChange={(v: ProjectionMode) => st.set('projection', v)}
              style={{ width: 92 }}
              options={[
                { value: 'none', label: 'No MIP' },
                { value: 'mip', label: 'MIP' },
                { value: 'minip', label: 'MinIP' },
                { value: 'average', label: 'Average' },
              ]}
            />
            <InputNumber
              size="small" min={0.5} max={200} step={0.5}
              value={st.slabThicknessMm}
              disabled={!st.mpr}
              onChange={(v) => v != null && st.set('slabThicknessMm', v)}
              style={{ width: 64 }}
              suffix="mm"
            />
          </div>
        )}

        <span className="tb-sep" />

        <TB
          label={st.cinePlaying ? 'Stop' : 'Play'}
          active={st.cinePlaying}
          disabled={in3dOrMpr}
          onClick={() => {
            if (st.cinePlaying) {
              stopCine(activeStackVp);
              st.set('cinePlaying', false);
            } else {
              playCine(activeStackVp, st.cineFps);
              st.set('cinePlaying', true);
            }
          }}
        />
        <div className="tb-cine">
          <Slider
            min={1} max={60}
            value={st.cineFps}
            onChange={(v) => st.set('cineFps', v)}
            style={{ width: 70 }}
            tooltip={{ formatter: (v) => `${v} fps` }}
          />
        </div>

        <span className="tb-sep" />

        <Tooltip title="Export a short clip as WebM">
          <span><TB label="Export Video" onClick={() => recordViewportWebM(activeStackVp, 4000)} /></span>
        </Tooltip>
        <Tooltip title="Save current frame as PNG">
          <span>
            <TB label="Capture" onClick={() => {
              const url = captureViewportPng(activeStackVp);
              if (url) {
                const a = document.createElement('a');
                a.href = url; a.download = 'capture.png'; a.click();
              }
            }} />
          </span>
        </Tooltip>

        <TB label="Overlay" active={st.showOverlay} onClick={() => st.set('showOverlay', !st.showOverlay)} />
        <TB label="Ref Lines" active={st.referenceLines} disabled={in3dOrMpr} onClick={() => st.set('referenceLines', !st.referenceLines)} />
        <TB
          label="Sync"
          badge={st.layout.rows * st.layout.cols > 1 ? undefined : 'x'}
          active={st.sync}
          disabled={in3dOrMpr || st.layout.rows * st.layout.cols < 2}
          onClick={() => st.set('sync', !st.sync)}
        />
        <TB label="Reset" onClick={resetAll} />
        <TB label="Compare" onClick={() => st.setLayout(1, 2)} />
        <TB label="Full" onClick={() => {
          const el = document.documentElement;
          if (document.fullscreenElement) document.exitFullscreen();
          else el.requestFullscreen?.();
        }} />
        <TB label="Report" onClick={() => onReport?.()} />
        <TB label="Shortcuts" onClick={() => setShortcutsOpen(true)} />
        <TB label="Hide bar" onClick={() => st.set('topBarHidden', true)} />
      </div>
      <button className="tb-chevron" onClick={() => scrollBy(300)} aria-label="scroll right">›</button>

      <Modal
        title="Viewer shortcuts"
        open={shortcutsOpen}
        onCancel={() => setShortcutsOpen(false)}
        footer={null}
      >
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
