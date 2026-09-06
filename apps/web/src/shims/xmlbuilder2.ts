// Lightweight browser shim for xmlbuilder2 (unused by DICOM rendering pipeline)
export function create() {
  const node: any = {
    root: () => node,
    ele: () => node,
    att: () => node,
    txt: () => node,
    end: () => '',
    getElementsByTagName: () => [],
  };
  return node;
}

export const fragment = create;
export default { create, fragment };
