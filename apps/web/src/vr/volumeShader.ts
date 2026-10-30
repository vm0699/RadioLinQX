// GPU ray-marching volume renderer (single-pass, works per eye in WebXR).
//
// The mesh is a unit cube whose local space == 3D-texture space; the camera
// position is transformed into that space in the vertex shader (per eye) and the
// fragment shader marches from the near to the far side of the cube with a fixed
// *physical* step, so quality is independent of view direction and anisotropic
// voxel spacing is handled correctly.

import * as THREE from 'three';
import type { PreparedVolume } from './volumeData';

const VERT = /* glsl */ `
out vec3 vOrigin;
out vec3 vDir;
void main() {
  mat4 invModel = inverse(modelMatrix);
  vOrigin = (invModel * vec4(cameraPosition, 1.0)).xyz;
  vDir = position - vOrigin;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2D;

#define MAX_STEPS 768

uniform sampler3D uVol;
uniform sampler2D uLut;
uniform sampler3D uMask;   // RG8: R = hidden, G = highlighted (segmentation)
uniform float uMaskOn;
uniform float uInvert;     // slice / MIP: invert the grayscale
uniform vec3  uHiColor;
uniform float uWinMin;
uniform float uWinInv;
uniform float uDensity;
uniform float uStepMm;
uniform float uRefMm;
uniform float uLighting;
uniform float uMip;
uniform vec3  uPhys;
uniform vec3  uSpacing;
uniform float uClipOn;
uniform float uClipPos;
uniform float uClipDir;
uniform vec3  uClipMask;
uniform float uSliceOn;
uniform float uSlicePos;
uniform vec3  uSliceMask;

in vec3 vOrigin;
in vec3 vDir;

float winMap(float v) { return clamp((v - uWinMin) * uWinInv, 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 gradient(vec3 p) {
  vec3 e = 1.0 / vec3(textureSize(uVol, 0));
  float dx = textureLod(uVol, p + vec3(e.x, 0.0, 0.0), 0.0).r - textureLod(uVol, p - vec3(e.x, 0.0, 0.0), 0.0).r;
  float dy = textureLod(uVol, p + vec3(0.0, e.y, 0.0), 0.0).r - textureLod(uVol, p - vec3(0.0, e.y, 0.0), 0.0).r;
  float dz = textureLod(uVol, p + vec3(0.0, 0.0, e.z), 0.0).r - textureLod(uVol, p - vec3(0.0, 0.0, e.z), 0.0).r;
  return vec3(dx, dy, dz) / (2.0 * uSpacing);
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 safe = mix(rd, vec3(1e-6), lessThan(abs(rd), vec3(1e-6)));
  vec3 inv = 1.0 / safe;
  vec3 t0 = (vec3(0.0) - vOrigin) * inv;
  vec3 t1 = (vec3(1.0) - vOrigin) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  if (tNear >= tFar) discard;

  // axis-aligned clip half-space: keep (dot(p, mask) - pos) * dir >= 0
  if (uClipOn > 0.5) {
    float a0 = (dot(vOrigin, uClipMask) - uClipPos) * uClipDir;
    float b = dot(rd, uClipMask) * uClipDir;
    if (abs(b) < 1e-7) {
      if (a0 < 0.0) discard;
    } else {
      float tc = -a0 / b;
      if (b > 0.0) tNear = max(tNear, tc); else tFar = min(tFar, tc);
    }
    if (tNear >= tFar) discard;
  }

  // MPR slice plane (opaque, window/levelled) living inside the volume
  float tSlice = -1.0;
  if (uSliceOn > 0.5 && uMip < 0.5) {
    float b = dot(rd, uSliceMask);
    if (abs(b) > 1e-7) {
      float ts = (uSlicePos - dot(vOrigin, uSliceMask)) / b;
      if (ts > tNear && ts < tFar) tSlice = ts;
    }
  }

  float lenMm = length(rd * uPhys);
  float dt = max(uStepMm / lenMm, (tFar - tNear) / float(MAX_STEPS - 1));
  float ratio = (dt * lenMm) / uRefMm;
  vec3 rdPhys = normalize(rd * uPhys);

  float t = tNear + hash(gl_FragCoord.xy) * dt;
  if (uDensity <= 0.0 && uMip < 0.5) t = tFar + 1.0; // slice-only mode: skip the march

  vec4 acc = vec4(0.0);
  float mipMax = 0.0;
  bool sliceDone = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (t > tFar) break;
    if (tSlice > 0.0 && !sliceDone && t >= tSlice) {
      vec3 sp = vOrigin + rd * tSlice;
      sliceDone = true;
      if (uMaskOn < 0.5 || textureLod(uMask, sp, 0.0).r < 0.5) {
        float sv = winMap(textureLod(uVol, sp, 0.0).r);
        if (uInvert > 0.5) sv = 1.0 - sv;
        acc.rgb += (1.0 - acc.a) * 0.98 * vec3(sv);
        acc.a += (1.0 - acc.a) * 0.98;
        break;
      }
    }
    vec3 p = vOrigin + rd * t;
    vec2 m = vec2(0.0);
    if (uMaskOn > 0.5) {
      m = textureLod(uMask, p, 0.0).rg;
      if (m.r > 0.5) { t += dt; continue; }   // hidden segment
    }
    float v = textureLod(uVol, p, 0.0).r;
    if (uMip > 0.5) {
      mipMax = max(mipMax, v);
    } else {
      vec4 c = textureLod(uLut, vec2(winMap(v), 0.5), 0.0);
      float a = c.a * uDensity;
      if (a > 0.003) {
        a = 1.0 - pow(1.0 - min(a, 0.995), ratio);
        vec3 col = c.rgb;
        if (uLighting > 0.5 && a > 0.01) {
          vec3 g = gradient(p);
          float gm = length(g);
          vec3 n = -g / max(gm, 1e-6);
          float d = abs(dot(n, -rdPhys));
          float k = smoothstep(0.002, 0.02, gm);
          col = mix(col, col * (0.35 + 0.65 * d) + pow(d, 20.0) * 0.22, k);
        }
        col = mix(col, uHiColor, m.g * 0.6);
        acc.rgb += (1.0 - acc.a) * a * col;
        acc.a += (1.0 - acc.a) * a;
        if (acc.a > 0.97) break;
      }
    }
    t += dt;
  }

  if (uMip > 0.5) {
    float w = winMap(mipMax);
    float al = clamp(w * 1.6, 0.0, 1.0) * clamp(uDensity, 0.0, 1.0);
    acc = vec4(vec3(w) * al, al);
  } else if (tSlice > 0.0 && !sliceDone && acc.a < 0.97) {
    vec3 sp = vOrigin + rd * tSlice;
    if (uMaskOn < 0.5 || textureLod(uMask, sp, 0.0).r < 0.5) {
      float sv = winMap(textureLod(uVol, sp, 0.0).r);
      if (uInvert > 0.5) sv = 1.0 - sv;
      acc.rgb += (1.0 - acc.a) * 0.98 * vec3(sv);
      acc.a += (1.0 - acc.a) * 0.98;
    }
  }

  gl_FragColor = acc;
}
`;

export function createVolumeMaterial(
  tex: THREE.Data3DTexture,
  lut: THREE.DataTexture,
  vol: PreparedVolume,
  mask: THREE.Data3DTexture,
): THREE.ShaderMaterial {
  const [sx, sy, sz] = vol.sampled.spacing;
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uVol: { value: tex },
      uLut: { value: lut },
      uMask: { value: mask },
      uMaskOn: { value: 0 },
      uInvert: { value: 0 },
      uHiColor: { value: new THREE.Vector3(1, 0.85, 0.2) },
      uWinMin: { value: 0 },
      uWinInv: { value: 1 },
      uDensity: { value: 1 },
      uStepMm: { value: Math.min(sx, sy, sz) },
      uRefMm: { value: (sx + sy + sz) / 3 },
      uLighting: { value: 1 },
      uMip: { value: 0 },
      uPhys: { value: new THREE.Vector3(...vol.sizeMm) },
      uSpacing: { value: new THREE.Vector3(sx, sy, sz) },
      uClipOn: { value: 0 },
      uClipPos: { value: 0.5 },
      uClipDir: { value: 1 },
      uClipMask: { value: new THREE.Vector3(0, 0, 1) },
      uSliceOn: { value: 0 },
      uSlicePos: { value: 0.5 },
      uSliceMask: { value: new THREE.Vector3(0, 0, 1) },
    },
  });
}
