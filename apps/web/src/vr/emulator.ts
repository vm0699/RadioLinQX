// DEV ONLY — installs a software Meta Quest 3 (IWER) so the whole WebXR path can be
// exercised in a normal desktop browser:   http://localhost:5173/vr?...&emulateXR=1
// Imported dynamically from main.tsx behind `import.meta.env.DEV`; never shipped.

import { XRDevice, metaQuest3 } from 'iwer';

const device = new XRDevice(metaQuest3);
device.installRuntime({ forceInstall: true });
(window as unknown as { __xrDevice: XRDevice }).__xrDevice = device;
