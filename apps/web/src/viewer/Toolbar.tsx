import { useNavigate } from 'react-router-dom';
import { Dropdown, Slider, InputNumber, Select, Popover, Button, Tooltip } from 'antd';
import { useViewer, type ProjectionMode, type PrimaryToolKey } from './store';
import { setPrimaryTool, MEASURE_MENU } from './tools';
import {
  rotate,
  stackViewportId,
  playCine,
  stopCine,
  captureViewportPng,
} from './renderingManager';
import * as csTools from '@cornerstonejs/tools';
import { getRenderingEngine } from '@cornerstonejs/core';
import { ENGINE_ID } from './renderingManager';
import { recordViewportWebM } from './videoExport';

function ToolButton({
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

export function Toolbar() {
  const navigate = useNavigate();
  const st = useViewer();
  const activeStackVp = stackViewportId(st.activeViewportIndex);

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
      <div className="dim" style={{ marginTop: 6 }}>
        {st.layout.rows} × {st.layout.cols}
      </div>
    </div>
  );

  return (
    <div className="toolbar">
      <ToolButton label="Cases" onClick={() => navigate('/')} />
      <span className="tb-sep" />

      <ToolButton
        label="Stack"
        badge="L"
        active={st.primaryTool === 'WindowLevel' && false}
        onClick={() => pick('WindowLevel')}
      />
      <ToolButton
        label="Zoom"
        active={st.primaryTool === 'Zoom'}
        onClick={() => pick('Zoom')}
      />
      <ToolButton
        label="Pan"
        active={st.primaryTool === 'Pan'}
        onClick={() => pick('Pan')}
      />
      <ToolButton
        label="W/L"
        badge="R"
        active={st.primaryTool === 'WindowLevel'}
        onClick={() => pick('WindowLevel')}
      />
      <ToolButton label="Rotate" onClick={() => rotate(90)} />

      <Dropdown
        menu={{
          items: MEASURE_MENU.map((m) => ({ key: m.key, label: m.label })),
          onClick: ({ key }) => {
            const entry = MEASURE_MENU.find((m) => m.key === key);
            if (entry) pick(entry.toolKey as PrimaryToolKey);
          },
        }}
      >
        <span>
          <ToolButton
            label="Measure ▾"
            active={MEASURE_MENU.some(
              (m) => m.toolKey === st.primaryTool,
            )}
          />
        </span>
      </Dropdown>

      <ToolButton label="Delete" onClick={clearAnnotations} />

      <Popover content={gridPopover} trigger="click" placement="bottom">
        <span>
          <ToolButton label="Grid" disabled={st.mpr} />
        </span>
      </Popover>

      <ToolButton
        label="Localizer"
        active={st.referenceLines}
        disabled={st.mpr}
        onClick={() => st.set('referenceLines', !st.referenceLines)}
      />

      <span className="tb-sep" />

      <ToolButton
        label="MPR"
        active={st.mpr}
        disabled={st.series.length === 0}
        onClick={() => st.set('mpr', !st.mpr)}
      />
      <ToolButton
        label="Cross"
        active={st.crosshairs}
        disabled={!st.mpr}
        onClick={() => st.set('crosshairs', !st.crosshairs)}
      />

      {(['none', 'mip', 'minip', 'average'] as ProjectionMode[]).length > 0 && null}

      <div className="tb-plane" aria-disabled={!st.mpr}>
        {(['Ax', 'Cor', 'Sag'] as const).map((p) => (
          <button key={p} className="tb-plane-btn" disabled={!st.mpr}>
            {p}
          </button>
        ))}
      </div>

      <div className={`tb-slab${st.mpr ? '' : ' disabled'}`}>
        <Slider
          min={0.5}
          max={200}
          step={0.5}
          value={st.slabThicknessMm}
          onChange={(v) => st.set('slabThicknessMm', v)}
          disabled={!st.mpr}
          style={{ width: 120 }}
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
          size="small"
          min={0.5}
          max={200}
          step={0.5}
          value={st.slabThicknessMm}
          disabled={!st.mpr}
          onChange={(v) => v != null && st.set('slabThicknessMm', v)}
          style={{ width: 64 }}
          suffix="mm"
        />
      </div>

      <span className="tb-sep" />

      <ToolButton
        label={st.cinePlaying ? 'Stop' : 'Play'}
        active={st.cinePlaying}
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
          min={1}
          max={60}
          value={st.cineFps}
          onChange={(v) => st.set('cineFps', v)}
          style={{ width: 80 }}
          tooltip={{ formatter: (v) => `${v} fps` }}
        />
      </div>

      <Tooltip title="Capture current frame as PNG">
        <span>
          <ToolButton
            label="Capture"
            onClick={() => {
              const url = captureViewportPng(activeStackVp);
              if (url) {
                const a = document.createElement('a');
                a.href = url;
                a.download = 'capture.png';
                a.click();
              }
            }}
          />
        </span>
      </Tooltip>

      <Button
        size="small"
        type="primary"
        ghost
        onClick={() => recordViewportWebM(activeStackVp, 4000)}
      >
        Export Video
      </Button>
    </div>
  );
}
