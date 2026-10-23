import { useEffect, useState } from 'react';

export interface XRSupport {
  /** navigator.xr exists and the page is a secure context */
  available: boolean;
  vr: boolean;
  ar: boolean;
  checked: boolean;
}

type XRNav = Navigator & {
  xr?: {
    isSessionSupported: (mode: string) => Promise<boolean>;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: (type: string, cb: () => void) => void;
  };
};

async function probe(): Promise<XRSupport> {
  const xr = (navigator as XRNav).xr;
  if (!xr) return { available: false, vr: false, ar: false, checked: true };
  const ask = (mode: string) => xr.isSessionSupported(mode).catch(() => false);
  const [vr, ar] = await Promise.all([ask('immersive-vr'), ask('immersive-ar')]);
  return { available: true, vr, ar, checked: true };
}

/** Live "is a VR/AR headset connected" signal (re-probed on `devicechange`). */
export function useXRSupport(): XRSupport {
  const [s, setS] = useState<XRSupport>({ available: false, vr: false, ar: false, checked: false });
  useEffect(() => {
    let live = true;
    const run = () => probe().then((r) => live && setS(r));
    run();
    const xr = (navigator as XRNav).xr;
    xr?.addEventListener('devicechange', run);
    window.addEventListener('xr-emulator-ready', run); // dev: software headset installed
    return () => {
      live = false;
      xr?.removeEventListener('devicechange', run);
      window.removeEventListener('xr-emulator-ready', run);
    };
  }, []);
  return s;
}

/** Series that make sense as a 3D volume (not single frames / cine / colour). */
export function isVolumetric(s: { modality?: string; instanceCount?: number }): boolean {
  const m = (s.modality ?? '').toUpperCase();
  if (['US', 'XA', 'RF', 'CR', 'DX', 'MG', 'OT', 'DOC', 'ES', 'SC'].includes(m)) return false;
  return (s.instanceCount ?? 0) >= 12;
}

/** URL of the VR page for a case/series. */
export function vrUrl(caseId: string | undefined, studyUid: string, seriesUid?: string): string {
  const q = new URLSearchParams();
  if (caseId) q.set('case', caseId);
  q.set('study', studyUid);
  if (seriesUid) q.set('series', seriesUid);
  return `/vr?${q.toString()}`;
}
