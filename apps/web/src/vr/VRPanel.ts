// A tiny immediate-mode UI drawn on a canvas texture — the in-headset control
// tablet. Pointer events come from a controller ray (uv on the plane + trigger).

import * as THREE from 'three';

export interface BtnDesc {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Widget {
  type: 'button' | 'slider';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  min?: number;
  max?: number;
  value?: number;
  format?: (v: number) => string;
  onChange?: (v: number) => void;
  id: string;
}

const W = 1280;
const H = 960;
const COL_X = [28, 660];
const COL_W = 592;
const GAP = 10;

const C = {
  bg: 'rgba(10,16,30,0.94)',
  card: '#16223a',
  cardHover: '#21345a',
  accent: '#3b82f6',
  teal: '#2dd4bf',
  text: '#e6edf7',
  dim: '#8ea0bd',
  off: '#0f1a30',
};

export class VRPanel {
  readonly mesh: THREE.Mesh;
  readonly widthM: number;
  readonly heightM: number;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private widgets: Widget[] = [];
  private texts: { x: number; y: number; text: string; color: string; size: number; bold?: boolean; align?: CanvasTextAlign }[] = [];
  private cy = [90, 90];
  private col = 0;
  private hoverId: string | null = null;
  private dragId: string | null = null;
  private wasPressed = false;
  private dirty = true;
  private idSeq = 0;
  /** fired with 'click' | 'drag' so the scene can buzz the controller */
  onFeedback?: () => void;

  constructor(widthM = 0.4) {
    this.widthM = widthM;
    this.heightM = (widthM * H) / W;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.widthM, this.heightM), mat);
    this.mesh.renderOrder = 50;
    this.mesh.name = 'vr-panel';
  }

  // ---- layout (called by the scene whenever state changes) ----------------

  begin() {
    this.widgets = [];
    this.texts = [];
    this.cy = [90, 90];
    this.col = 0;
    this.idSeq = 0;
  }

  column(i: number) {
    this.col = i;
  }

  title(text: string, right: string) {
    this.texts.push({ x: 28, y: 52, text, color: C.text, size: 38, bold: true });
    this.texts.push({ x: W - 28, y: 50, text: right, color: C.teal, size: 28, align: 'right' });
  }

  header(text: string) {
    const x = COL_X[this.col];
    this.texts.push({ x, y: this.cy[this.col] + 22, text: text.toUpperCase(), color: C.dim, size: 24, bold: true });
    this.cy[this.col] += 36;
  }

  note(text: string, color = C.dim, size = 26) {
    const x = COL_X[this.col];
    this.texts.push({ x, y: this.cy[this.col] + 24, text, color, size });
    this.cy[this.col] += size + 14;
  }

  buttons(items: BtnDesc[], perRow = items.length) {
    const x0 = COL_X[this.col];
    const bh = 64;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      const bw = (COL_W - GAP * (row.length - 1)) / row.length;
      row.forEach((b, k) =>
        this.widgets.push({
          type: 'button',
          id: `b${this.idSeq++}`,
          x: x0 + k * (bw + GAP),
          y: this.cy[this.col],
          w: bw,
          h: bh,
          label: b.label,
          active: b.active,
          disabled: b.disabled,
          onClick: b.onClick,
        }),
      );
      this.cy[this.col] += bh + GAP;
    }
    this.cy[this.col] += 8;
  }

  slider(label: string, value: number, min: number, max: number, format: (v: number) => string, onChange: (v: number) => void) {
    const x0 = COL_X[this.col];
    this.widgets.push({
      type: 'slider',
      id: `s${this.idSeq++}`,
      x: x0,
      y: this.cy[this.col],
      w: COL_W,
      h: 78,
      label,
      value,
      min,
      max,
      format,
      onChange,
    });
    this.cy[this.col] += 78 + 14;
  }

  end() {
    this.dirty = true;
  }

  // ---- pointer ------------------------------------------------------------

  /**
   * @param uv  position of the ray on the panel's plane (0..1, unbounded), or null
   * @param pressed trigger state
   */
  update(uv: THREE.Vector2 | null, pressed: boolean) {
    let hover: Widget | null = null;
    let px = 0;
    let py = 0;
    if (uv) {
      px = uv.x * W;
      py = (1 - uv.y) * H;
      hover = this.widgets.find((w) => px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) ?? null;
    }

    const rising = pressed && !this.wasPressed;
    const falling = !pressed && this.wasPressed;
    this.wasPressed = pressed;

    const newHover = hover && !hover.disabled ? hover.id : null;
    if (newHover !== this.hoverId) {
      this.hoverId = newHover;
      this.dirty = true;
    }

    if (rising && hover && !hover.disabled) {
      if (hover.type === 'button') {
        hover.onClick?.();
        this.onFeedback?.();
      } else {
        this.dragId = hover.id;
      }
    }
    if (falling) this.dragId = null;

    if (this.dragId && pressed && uv) {
      const w = this.widgets.find((x) => x.id === this.dragId);
      if (w && w.type === 'slider') {
        const pad = 16;
        const t = Math.max(0, Math.min(1, (px - w.x - pad) / (w.w - 2 * pad)));
        const v = (w.min ?? 0) + t * ((w.max ?? 1) - (w.min ?? 0));
        if (Math.abs(v - (w.value ?? 0)) > 1e-6) {
          w.value = v;
          w.onChange?.(v);
          this.dirty = true;
        }
      }
    }
    if (this.dirty) this.draw();
  }

  /** true while the ray should keep "owning" the trigger (dragging a slider) */
  get dragging() {
    return this.dragId !== null;
  }

  // ---- drawing --------------------------------------------------------------

  private rr(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  draw() {
    this.dirty = false;
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    this.rr(0, 0, W, H, 36);
    c.fillStyle = C.bg;
    c.fill();
    c.strokeStyle = 'rgba(59,130,246,0.55)';
    c.lineWidth = 3;
    c.stroke();

    // title rule
    c.fillStyle = 'rgba(142,160,189,0.25)';
    c.fillRect(28, 72, W - 56, 2);

    for (const t of this.texts) {
      c.font = `${t.bold ? '700 ' : '500 '}${t.size}px Inter, system-ui, sans-serif`;
      c.fillStyle = t.color;
      c.textAlign = t.align ?? 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(t.text, t.x, t.y);
    }

    for (const w of this.widgets) {
      const hovered = w.id === this.hoverId;
      if (w.type === 'button') {
        this.rr(w.x, w.y, w.w, w.h, 14);
        c.fillStyle = w.disabled ? C.off : w.active ? C.accent : hovered ? C.cardHover : C.card;
        c.fill();
        if (hovered && !w.disabled) {
          c.strokeStyle = C.teal;
          c.lineWidth = 4;
          c.stroke();
        }
        c.font = '600 30px Inter, system-ui, sans-serif';
        c.fillStyle = w.disabled ? '#4b5a76' : '#ffffff';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(w.label, w.x + w.w / 2, w.y + w.h / 2 + 1);
      } else {
        this.rr(w.x, w.y, w.w, w.h, 14);
        c.fillStyle = hovered || w.id === this.dragId ? C.cardHover : C.card;
        c.fill();
        c.font = '600 27px Inter, system-ui, sans-serif';
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.fillStyle = C.dim;
        c.fillText(w.label, w.x + 16, w.y + 30);
        c.textAlign = 'right';
        c.fillStyle = C.text;
        c.fillText(w.format ? w.format(w.value ?? 0) : String(w.value), w.x + w.w - 16, w.y + 30);
        const bx = w.x + 16;
        const bw = w.w - 32;
        const by = w.y + 52;
        this.rr(bx, by, bw, 12, 6);
        c.fillStyle = '#0b1424';
        c.fill();
        const t = ((w.value ?? 0) - (w.min ?? 0)) / (((w.max ?? 1) - (w.min ?? 0)) || 1);
        this.rr(bx, by, Math.max(12, bw * t), 12, 6);
        c.fillStyle = C.accent;
        c.fill();
        c.beginPath();
        c.arc(bx + bw * t, by + 6, 15, 0, Math.PI * 2);
        c.fillStyle = C.teal;
        c.fill();
      }
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
