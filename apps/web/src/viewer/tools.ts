// Tool registration + the mapping from RadioLinQ's toolbar to Cornerstone3D
// tool names. Missing tool classes (version differences) are skipped gracefully.

import * as csTools from '@cornerstonejs/tools';

const { Enums: csToolsEnums, ToolGroupManager, addTool } = csTools;
const { MouseBindings } = csToolsEnums;

export const TOOL_GROUP_ID = 'RADIOLINQ_TOOLGROUP';

/** Toolbar id -> Cornerstone tool class (guarded; may be undefined per version). */
const TOOL_CLASSES: Record<string, unknown> = {
  Pan: csTools.PanTool,
  Zoom: csTools.ZoomTool,
  WindowLevel: csTools.WindowLevelTool,
  // v5 folds wheel-scroll into StackScrollTool via a Wheel binding.
  StackScroll: (csTools as any).StackScrollTool,
  Magnify: (csTools as any).MagnifyTool,
  // annotations
  Length: csTools.LengthTool,
  Angle: csTools.AngleTool,
  CobbAngle: (csTools as any).CobbAngleTool,
  RectangleROI: (csTools as any).RectangleROITool,
  EllipticalROI: (csTools as any).EllipticalROITool,
  CircleROI: (csTools as any).CircleROITool,
  PlanarFreehandROI: (csTools as any).PlanarFreehandROITool,
  SplineROI: (csTools as any).SplineROITool,
  ArrowAnnotate: (csTools as any).ArrowAnnotateTool,
  Probe: csTools.ProbeTool,
  Label: (csTools as any).LabelTool,
  // 3D / reference
  Crosshairs: (csTools as any).CrosshairsTool,
  ReferenceLines: (csTools as any).ReferenceLinesTool,
  VolumeRotate: (csTools as any).VolumeRotateTool,
  TrackballRotate: (csTools as any).TrackballRotateTool,
};

function toolName(cls: unknown): string | undefined {
  return (cls as { toolName?: string } | undefined)?.toolName;
}

let toolsRegistered = false;

/**
 * Register every available tool class exactly once with the global tool
 * registry. Runs at module-load time (see bottom of file) so the registry is
 * populated before any React effect creates a ToolGroup.
 */
export function registerTools(): void {
  if (toolsRegistered) return;
  for (const cls of Object.values(TOOL_CLASSES)) {
    if (cls && toolName(cls)) {
      try {
        addTool(cls as Parameters<typeof addTool>[0]);
      } catch {
        /* already added */
      }
    }
  }
  toolsRegistered = true;
}

// Populate the registry immediately on import.
registerTools();

/** Names of annotation tools we expose in the Measure menu. */
export const ANNOTATION_TOOLS = [
  'Length',
  'Angle',
  'CobbAngle',
  'RectangleROI',
  'EllipticalROI',
  'PlanarFreehandROI',
  'SplineROI',
  'ArrowAnnotate',
  'Probe',
  'Label',
] as const;

export const MEASURE_MENU: { key: string; label: string; toolKey: string }[] = [
  { key: 'length', label: 'Length', toolKey: 'Length' },
  { key: 'angle', label: 'Angle', toolKey: 'Angle' },
  { key: 'cobb', label: 'Cobb Angle', toolKey: 'CobbAngle' },
  { key: 'rect', label: 'Rectangle', toolKey: 'RectangleROI' },
  { key: 'ellipse', label: 'Ellipse', toolKey: 'EllipticalROI' },
  { key: 'freehand', label: 'Freehand', toolKey: 'PlanarFreehandROI' },
  { key: 'polygon', label: 'Polygon', toolKey: 'SplineROI' },
  { key: 'arrow', label: 'Arrow', toolKey: 'ArrowAnnotate' },
  { key: 'probe', label: 'Probe', toolKey: 'Probe' },
  { key: 'text', label: 'Text', toolKey: 'Label' },
];

export function resolveToolName(toolKey: string): string | undefined {
  return toolName(TOOL_CLASSES[toolKey]);
}

export interface ToolGroupHandle {
  id: string;
  group: ReturnType<typeof ToolGroupManager.createToolGroup>;
}

/** Create (or reuse) the shared tool group and give it sane default bindings. */
export function ensureToolGroup(): NonNullable<
  ReturnType<typeof ToolGroupManager.getToolGroup>
> {
  const existing = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (existing) return existing;

  const group = ToolGroupManager.createToolGroup(TOOL_GROUP_ID)!;

  const add = (key: string, passive = true) => {
    const name = resolveToolName(key);
    if (!name) return;
    try {
      group.addTool(name);
      if (passive) group.setToolPassive(name);
    } catch {
      /* ignore */
    }
  };

  // interaction tools
  add('Pan');
  add('Zoom');
  add('WindowLevel');
  add('StackScroll');
  add('Magnify');
  add('Crosshairs');
  add('ReferenceLines');
  add('VolumeRotate');
  add('TrackballRotate');
  // annotations
  for (const t of [
    'Length',
    'Angle',
    'CobbAngle',
    'RectangleROI',
    'EllipticalROI',
    'CircleROI',
    'PlanarFreehandROI',
    'SplineROI',
    'ArrowAnnotate',
    'Probe',
    'Label',
  ]) {
    add(t);
  }

  const wl = resolveToolName('WindowLevel');
  const pan = resolveToolName('Pan');
  const zoom = resolveToolName('Zoom');
  const stackScroll = resolveToolName('StackScroll');

  if (wl) group.setToolActive(wl, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  if (pan)
    group.setToolActive(pan, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  if (zoom)
    group.setToolActive(zoom, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
  // mouse-wheel scrolls the stack
  if (stackScroll)
    group.setToolActive(stackScroll, {
      bindings: [{ mouseButton: MouseBindings.Wheel }],
    });

  return group;
}

/** Switch which tool owns the left mouse button. */
export function setPrimaryTool(toolKey: string): void {
  const group = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!group) return;
  const name = resolveToolName(toolKey);
  if (!name) return;

  // Demote whatever currently holds Primary among our interaction+annotation set.
  const candidates = [
    'WindowLevel',
    'Pan',
    'Zoom',
    'Magnify',
    'Crosshairs',
    ...ANNOTATION_TOOLS,
  ];
  for (const key of candidates) {
    const n = resolveToolName(key);
    if (n && n !== name) {
      try {
        const mode = group.getToolInstance(n)?.mode;
        if (mode === 'Active') group.setToolPassive(n);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    group.setToolActive(name, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  } catch {
    /* ignore */
  }
}

export { csToolsEnums };
