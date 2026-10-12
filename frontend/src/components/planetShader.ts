/**
 * Procedural bodies. One quad per body; the fragment shader paints a lit, slowly turning sphere.
 *
 * One lighting model for the whole system: every planet is lit by the star at the centre
 * (the caller passes the direction to it in `uLight`), with a soft terminator, a thin warm
 * limb light on the lit side only, and a very restrained specular on wet or polished surfaces.
 * Ringed bodies cast shadows onto their rings and receive ring shadow back.
 */
export const VERT = `
attribute vec2 aPos;
uniform vec2 uRes, uCenter;
uniform float uRad, uQuad;
varying vec2 vUv;
void main() {
  vUv = aPos * uQuad;
  vec2 px = uCenter + vec2(aPos.x, -aPos.y) * uRad * uQuad;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

export const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uType, uDim, uAA, uSeed, uSpin, uRing, uShade;
uniform vec3 uLight, uTint;

float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float craters(vec3 p) {
  vec3 i = floor(p), f = fract(p); float h = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash(i + g + 0.1), hash(i + g + 7.7), hash(i + g + 3.3));
    float rad = 0.16 + 0.26 * hash(i + g + 5.5);
    float t = length(g + o - f) / rad;
    h += -smoothstep(1.0, 0.25, t) * 0.55 + exp(-pow((t - 1.0) * 5.0, 2.0)) * 0.45;
  }
  return h;
}

const vec3 SUNLIGHT = vec3(1.0, 0.92, 0.8);
const float RIN = 1.36, ROUT = 1.92;

// ring plane (view space); a little different per body so no two are posed alike
vec3 ringNormal() { return normalize(vec3(-0.24 + 0.1 * sin(uSeed * 1.7), 0.9, 0.44 + 0.04 * sin(uSeed))); }
float ringDensity(float rho) {
  float edge = smoothstep(RIN, RIN + 0.03, rho) * (1.0 - smoothstep(ROUT - 0.05, ROUT, rho));
  float bands = 0.66 + 0.2 * sin(rho * 30.0 + uSeed) + 0.14 * sin(rho * 71.0 + uSeed * 2.0);
  float gap = 1.0 - 0.8 * (smoothstep(0.035, 0.0, abs(rho - 1.7)));
  float inner = mix(0.45, 1.0, smoothstep(RIN, RIN + 0.25, rho));
  return clamp(edge * bands * gap * inner, 0.0, 1.0);
}

void main() {
  float r = length(vUv);
  vec3 L = normalize(uLight);
  vec3 nr = ringNormal();
  bool star = uType < 0.5;

  // ── the body ──
  vec3 body = vec3(0.0); float cov = clamp((1.0 - r) / uAA, 0.0, 1.0);
  vec3 atmo = vec3(0.6, 0.65, 0.7); float rimK = 0.25, haloK = 0.0, spec = 0.0, zs = -9.0;
  if (r < 1.0) {
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r * r))); zs = n.z;
    float a = uTime * uSpin + uSeed, tl = 0.3;
    mat3 ry = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a));
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(tl), sin(tl), 0.0, -sin(tl), cos(tl));
    vec3 p = ry * (rx * n);
    float diff = dot(n, L);
    vec3 c;
    if (star) {                                          // the star you are: ivory core, gold body, slow plasma
      vec3 q = p * 2.0; float t = uTime * 0.035;
      float w = fbm(q + vec3(0.0, t, 0.0));
      float m = fbm(q * 1.9 + w * 1.4 + vec3(t, 0.0, -t));
      float grain = fbm(q * 5.5 + vec3(0.0, -t * 2.0, t));
      c = mix(vec3(0.7, 0.4, 0.15), vec3(0.94, 0.68, 0.32), smoothstep(0.2, 0.75, m));
      c = mix(c, vec3(1.0, 0.92, 0.72), smoothstep(0.45, 0.9, m) * 0.5);
      c *= 0.93 + 0.14 * grain;
      float mu = pow(n.z, 0.55);                         // limb darkening: warm and deep at the edge, ivory in the middle
      c = mix(c * vec3(0.78, 0.4, 0.2), c, mu);
      c += vec3(1.0, 0.93, 0.74) * pow(n.z, 5.0) * 0.14;
      body = c * 1.05; haloK = 1.0;
    } else {
      float lat = abs(p.y);
      if (uType < 1.5) {                                 // study: ice giant, soft latitude bands, deep indigo
        float b = sin(p.y * 7.5 + fbm(p * 2.4 + uSeed) * 2.8);
        c = mix(vec3(0.06, 0.08, 0.19), vec3(0.3, 0.38, 0.56), 0.5 + 0.4 * b);
        c = mix(c, vec3(0.5, 0.56, 0.68), smoothstep(0.3, 0.0, length(vec2(p.x - 0.3, (p.y + 0.3) * 2.4))) * 0.14);
        c *= 1.0 - 0.35 * smoothstep(0.6, 1.0, lat);
        atmo = vec3(0.5, 0.58, 0.78); rimK = 0.34;
      } else if (uType < 2.5) {                          // work: copper and basalt
        float nn = fbm(p * 2.8 + uSeed);
        c = mix(vec3(0.19, 0.085, 0.055), vec3(0.55, 0.32, 0.2), nn);
        c = mix(c, vec3(0.1, 0.05, 0.035), smoothstep(0.55, 0.78, fbm(p * 1.9 + 4.0)) * 0.8);
        c *= 0.82 + 0.4 * fbm(p * 8.0);
        c = mix(c, vec3(0.6, 0.5, 0.44), smoothstep(0.86, 0.96, lat) * 0.35);
        atmo = vec3(0.8, 0.5, 0.36); rimK = 0.22;
      } else if (uType < 3.5) {                          // personal: deep ocean, muted land, thin cloud
        float h = fbm(p * 2.1 + uSeed);
        float land = smoothstep(0.52, 0.545, h);
        vec3 ocean = mix(vec3(0.015, 0.06, 0.09), vec3(0.08, 0.22, 0.25), smoothstep(0.3, 0.52, h));
        vec3 gr = mix(vec3(0.15, 0.2, 0.15), vec3(0.37, 0.34, 0.26), smoothstep(0.56, 0.78, h));
        c = mix(ocean, gr, land);
        c = mix(c, vec3(0.6, 0.62, 0.6), smoothstep(0.82, 0.95, lat) * 0.6);
        float cl = smoothstep(0.52, 0.76, fbm(p * 3.4 + vec3(uTime * 0.02, 0.0, 0.0) + 9.0));
        c = mix(c, vec3(0.74, 0.76, 0.74), cl * 0.5);
        atmo = vec3(0.5, 0.64, 0.7); rimK = 0.38; spec = (1.0 - land) * (1.0 - cl) * 0.07;
      } else if (uType < 4.5) {                          // other: charcoal, cratered regolith
        float nn = fbm(p * 4.0 + uSeed);
        c = mix(vec3(0.17), vec3(0.46), nn);
        c *= mix(0.65, 1.0, smoothstep(0.4, 0.62, fbm(p * 1.5 + 3.0)));
        c *= 1.0 + (craters(p * 2.6) + 0.5 * craters(p * 6.0)) * 0.42;
        atmo = vec3(0.6, 0.6, 0.62); rimK = 0.06;
      } else {                                           // finance: mineral green, fine banding, a trace of gold
        float w = fbm(p * 1.8 + uSeed);
        float band = 0.5 + 0.5 * sin((w + fbm(p * 5.0) * 0.25) * 17.0);
        c = mix(vec3(0.07, 0.15, 0.13), vec3(0.25, 0.37, 0.31), 0.15 + 0.7 * band);
        c = mix(c, vec3(0.5, 0.58, 0.5), smoothstep(0.8, 0.98, band) * 0.25);
        float vein = 1.0 - smoothstep(0.0, 0.03, abs(fbm(p * 3.2 + 7.0) - 0.5));
        c += vec3(0.6, 0.5, 0.28) * vein * 0.16;
        atmo = vec3(0.52, 0.66, 0.6); rimK = 0.3; spec = 0.04;
      }
      c *= uTint;
      c *= 0.9 + 0.2 * fbm(p * 14.0 + uSeed);             // fine grain so nothing reads as a flat fill

      // lighting: soft terminator, a whisper of earthshine, warm limb light on the lit side only
      float lit = smoothstep(-0.12, 0.62, diff);
      float day = pow(clamp(diff, 0.0, 1.0), 0.8);
      vec3 shade = c * SUNLIGHT * (0.035 + 0.36 * lit + 0.95 * day);
      // ring shadow falling on the planet
      if (uRing > 0.0 && dot(nr, L) != 0.0) {
        float s = -dot(nr, n) / dot(nr, L);
        if (s > 0.0) shade *= 1.0 - 0.72 * uRing * ringDensity(length(n + L * s));
      }
      float fres = pow(1.0 - n.z, 3.0);
      vec3 rim = mix(atmo, SUNLIGHT, 0.5) * uTint;
      shade += rim * fres * smoothstep(-0.2, 0.55, diff) * rimK * 0.8;
      vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
      shade += SUNLIGHT * pow(clamp(dot(n, Hh), 0.0, 1.0), 48.0) * spec * day;
      body = shade;
      haloK = rimK;
    }
  }

  // ── rings: crossing the plane through the centre ──
  vec3 ringRGB = vec3(0.0); float ringA = 0.0; bool ringFront = true;
  if (uRing > 0.0) {
    float t = -(nr.x * vUv.x + nr.y * vUv.y) / nr.z;
    vec3 P = vec3(vUv, t);
    float rho = length(P);
    float d = ringDensity(rho) * uRing;
    if (d > 0.002) {
      float b = dot(P, L), disc = b * b - (dot(P, P) - 1.0);
      float shadow = (b < 0.0 && disc > 0.0) ? smoothstep(0.0, 0.06, disc) : 0.0;
      float face = 0.38 + 0.62 * abs(dot(nr, L));
      vec3 base = mix(vec3(0.55, 0.52, 0.47), vec3(0.4, 0.42, 0.5), 0.5 + 0.5 * sin(rho * 23.0)) * mix(vec3(1.0), uTint, 0.5);
      ringRGB = base * SUNLIGHT * face * mix(1.0, 0.1, shadow) * (0.8 + 0.4 * ringDensity(rho * 1.01));
      ringA = d * 0.82;
      ringFront = r >= 1.0 || t > zs;
    }
  }

  // ── halo: a thin scatter on the lit limb for planets; a soft bloom for the star ──
  float limb = max(r - 1.0, 0.0);
  float lit2 = clamp(dot(normalize(vUv + 1e-4), L.xy) * 0.5 + 0.55, 0.0, 1.0);
  vec3 halo = vec3(0.0); float haloA = 0.0;
  if (star) {
    float bloom = exp(-limb * 2.6) * (1.0 - smoothstep(1.9, 2.6, r)) + exp(-limb * 9.0) * 0.5;
    halo = vec3(1.0, 0.7, 0.34) * bloom * 0.42; haloA = bloom * 0.26;
  } else {
    float th = exp(-limb * 26.0) * (1.0 - smoothstep(1.06, 1.2, r)) * (0.1 + 0.9 * lit2) * haloK;
    halo = mix(atmo, SUNLIGHT, 0.55) * uTint * th * 0.22; haloA = th * 0.1;
  }

  // ── composite, premultiplied: halo, then back ring, body, front ring ──
  vec3 rgb = halo * (1.0 - cov); float al = haloA * (1.0 - cov);
  rgb += body * cov; al += cov;
  if (ringA > 0.0) {
    if (ringFront) { rgb = ringRGB * ringA + rgb * (1.0 - ringA); al = ringA + al * (1.0 - ringA); }
    else if (cov < 1.0) { float k = ringA * (1.0 - cov); rgb = rgb + ringRGB * k; al = al + k; }
  }
  gl_FragColor = vec4(rgb * uDim * uShade, clamp(al, 0.0, 1.0) * uDim);
}`;
