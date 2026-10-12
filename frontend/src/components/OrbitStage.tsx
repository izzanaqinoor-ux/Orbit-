import { useEffect, useRef } from "react";
import { FRAG, VERT } from "./planetShader";

export interface Body {
  type: 0 | 1 | 2 | 3 | 4 | 5;  // 0 sun, 1 study, 2 work, 3 personal, 4 other, 5 finance
  scale: number;                // 0..1: how heavy this body is relative to the heaviest
  label: string;
  sub: string;
  seed?: number;                // varies the surface so two planets of one kind differ
  tint?: [number, number, number]; // colour shift for user-chosen colours
  rank: number;                 // orbit order, 0 = innermost (sooner deadline); ignored for the sun
}
export interface StageProps {
  bodies: Body[];
  mode: "system" | "focus";
  index: number;                // focused body
  onPick: (i: number) => void;
  onStep: (dir: 1 | -1) => void;
  /** "refined": thin, dark, depth-faded rings (default). "classic": the original even hairlines. */
  orbitLines?: "refined" | "classic";
}

const sm = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const FONT = "Newsreader, 'Iowan Old Style', Georgia, serif";
const UI = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FOCUS_LIGHT: [number, number, number] = [-0.45, 0.55, 0.7];

/** Focus layout: where a body sits given its signed distance `d` from the hero slot. */
export function layout(W: number, H: number, d: number, s: number) {
  const m = Math.min(W, H), ad = Math.abs(d), sign = d < 0 ? -1 : 1;
  const R0 = Math.min(W * 0.64, H * 0.9);
  const rh = R0 * (0.5 + 0.5 * s);
  const hx = W / 2, hy = H * 0.64 + rh;
  const rn = m * 0.2 * (0.6 + 0.4 * s);
  const nx = W / 2 + sign * (W / 2 + rn * 0.05), ny = H * 0.47;
  const e = sm(Math.min(ad, 1));
  let x = hx + (nx - hx) * e, y = hy + (ny - hy) * e, r = rh + (rn - rh) * e;
  let dim = 1 - 0.5 * e;
  if (ad > 1) { const f = ad - 1; x += sign * f * W * 0.5; r = rn * (1 - 0.1 * Math.min(f, 1)); dim = 0.5 * Math.max(0, 1 - f * 1.2); }
  return { x, y, r, dim };
}

/** System geometry shared by drawing and the page's labels. */
export function systemGeometry(W: number, H: number) {
  const m = Math.min(W, H), narrow = W < 520;
  const tilt = narrow ? 0.9 : 0.42;
  const sunR = m * (narrow ? 0.07 : 0.06);
  const Rmax = m * (narrow ? 0.065 : 0.062), Rmin = Rmax * 0.4;
  const cx = W / 2, cy = H * (narrow ? 0.62 : 0.62);
  const aMin = (sunR + Rmax * 1.15) / tilt;
  const aMax = Math.max(aMin + 30, Math.min(W / 2 - Rmax - 10, (cy - 120 - Rmax) / tilt));
  return { m, tilt, sunR, Rmax, Rmin, cx, cy, aMin, aMax };
}

const FALLBACK = ["#d8b273", "#8ea8c3", "#c4876a", "#93b39f", "#a8a8b2", "#8fb1ad"];

export function OrbitStage(props: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const starRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const el = host.current!, sc = starRef.current!, glc = glRef.current!, fx = fxRef.current!;
    const s2 = sc.getContext("2d")!, f2 = fx.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = glc.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();
    const n = live.current.bodies.length;
    let pos = live.current.index, tgt = live.current.index, lastIdx = live.current.index;
    let m = live.current.mode === "focus" ? 1 : 0, lastMode = live.current.mode;
    const sc0 = live.current.bodies.map((b) => b.scale);
    const st = live.current.bodies.map((b, i) => ({ angle: (i / (n - 1)) * Math.PI * 2 + 0.7, a: 0, r: 0, speed: 1, rank: b.rank, rot: ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.07 }));
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, px: -1, py: -1 };
    let hits: { i: number; x: number; y: number; r: number }[] = [];
    let hover = -1;
    const stars = Array.from({ length: 230 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() < 0.12 ? 1.6 : 0.8 + Math.random() * 0.5, p: Math.random() * 6.28, f: 0.3 + Math.random() * 1.2 }));

    let prog: WebGLProgram | null = null;
    const U: Record<string, WebGLUniformLocation | null> = {};
    if (gl) {
      const mk = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram()!;
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const k of ["uRes", "uCenter", "uRad", "uTime", "uType", "uDim", "uAA", "uSeed", "uSpin", "uLight", "uTint", "uQuad", "uRing", "uShade"]) U[k] = gl.getUniformLocation(prog, k);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    const resize = () => {
      const r = el.getBoundingClientRect(); W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      for (const c of [sc, glc, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + "px"; c.style.height = H + "px"; }
    };
    resize(); const ro = new ResizeObserver(resize); ro.observe(el);

    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); ptr.px = e.clientX - r.left; ptr.py = e.clientY - r.top; ptr.tx = ptr.px / r.width - 0.5; ptr.ty = ptr.py / r.height - 0.5; };
    const onLeave = () => { ptr.px = -1; ptr.py = -1; };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; onMove(e); };
    const onUp = (e: PointerEvent) => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
      const P = live.current;
      if (P.mode === "focus" && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return P.onStep(dx < 0 ? 1 : -1);
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        const h = hits.find((q) => Math.hypot(q.x - px, q.y - py) <= q.r + (P.mode === "system" ? 8 : 0) && !(P.mode === "focus" && q.i === P.index));
        if (h) P.onPick(h.i);
      }
    };
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerdown", onDown); el.addEventListener("pointerup", onUp); el.addEventListener("pointerleave", onLeave);

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      const P = live.current, g = systemGeometry(W, H);

      // focus carousel position
      if (P.mode === "focus" && lastMode === "system") { pos = tgt = P.index; lastIdx = P.index; }
      lastMode = P.mode;
      if (P.index !== lastIdx) { let d = (((P.index - tgt) % n) + n) % n; if (d > n / 2) d -= n; tgt += d; lastIdx = P.index; }
      pos += (tgt - pos) * (1 - Math.exp(-dt * (reduce ? 40 : 4.2)));
      m += ((P.mode === "focus" ? 1 : 0) - m) * (1 - Math.exp(-dt * (reduce ? 40 : 3.2)));
      const e = sm(Math.min(1, Math.max(0, m)));
      P.bodies.forEach((b, i) => { sc0[i] += (b.scale - sc0[i]) * (1 - Math.exp(-dt * 2.6)); st[i].rank = b.rank; });
      ptr.x += (ptr.tx - ptr.x) * 0.06; ptr.y += (ptr.ty - ptr.y) * 0.06;

      // ── per-body placement: blend system layout and focus layout ──
      const placed = P.bodies.map((b, i) => {
        const s = st[i];
        // system
        let sx = g.cx, sy = g.cy, sr = g.sunR, key = 0;
        if (i !== 0) {
          const ta = g.aMin + ((g.aMax - g.aMin) * s.rank) / Math.max(1, n - 2);
          s.a = s.a === 0 ? ta : lerp(s.a, ta, 1 - Math.exp(-dt * 3));
          const slow = hover === i && P.mode === "system" ? 0.15 : 1;
          s.speed = lerp(s.speed, slow, 1 - Math.exp(-dt * 5));
          s.angle += ((Math.PI * 2) / 70) * Math.pow(g.aMin / s.a, 1.5) * 1.5 * s.speed * (reduce ? 0.1 : 1) * (1 - e) * dt;
          const ex = s.a * Math.cos(s.angle), ey = s.a * g.tilt * Math.sin(s.angle), cr = Math.cos(s.rot), sn = Math.sin(s.rot);
          sx = g.cx + ex * cr - ey * sn; sy = g.cy + ex * sn + ey * cr;
          key = Math.sin(s.angle);
          sr = (g.Rmin + (g.Rmax - g.Rmin) * sc0[i]) * (1 + 0.06 * key);   // a little larger when nearer the viewer
        }
        // focus
        let d = (((i - pos) % n) + n) % n; if (d > n / 2) d -= n;
        const F = layout(W, H, d, i === 0 ? 1 : sc0[i]);
        const x = lerp(sx, F.x, e) + ptr.x * 14 * e, y = lerp(sy, F.y, e) + ptr.y * 8 * e;
        return { i, type: b.type, x, y, r: lerp(sr, F.r, e), dim: lerp(1, F.dim, e), shade: lerp(0.84 + 0.16 * (key * 0.5 + 0.5), 1, e), key: lerp(key, -Math.abs(d), e), label: b.label, sub: b.sub, seed: b.seed, tint: b.tint };
      }).filter((q) => q.dim > 0.01).sort((a, b) => a.key - b.key);
      hits = [...placed].reverse().map((q) => ({ i: q.i, x: q.x, y: q.y, r: Math.max(q.r, 12) }));
      hover = -1;
      if (ptr.px >= 0) { const h = hits.find((q) => Math.hypot(q.x - ptr.px, q.y - ptr.py) <= q.r + (P.mode === "system" ? 8 : 0) && !(P.mode === "focus" && q.i === P.index)); if (h) hover = h.i; }
      fx.style.cursor = hover >= 0 ? "pointer" : "default";

      // ── stars + orbit paths ──
      s2.setTransform(dpr, 0, 0, dpr, 0, 0); s2.clearRect(0, 0, W, H);
      for (const s of stars) {
        const tw = reduce ? 0.75 : 0.5 + 0.5 * Math.sin(t * s.f + s.p);
        s2.fillStyle = `rgba(236,232,222,${0.14 + 0.6 * tw * (s.s > 1.2 ? 1 : 0.7)})`;
        s2.fillRect(s.x * W - ptr.x * 6 * s.s, s.y * H - ptr.y * 4 * s.s, s.s, s.s);
      }
      // the star's light spilling into the space around it
      const sunQ = placed.find((q) => q.i === 0);
      if (sunQ) {
        const R = sunQ.r * (9 - 5 * e), sp = s2.createRadialGradient(sunQ.x, sunQ.y, sunQ.r * 0.8, sunQ.x, sunQ.y, R);
        sp.addColorStop(0, `rgba(255,178,92,${0.1 * sunQ.dim})`); sp.addColorStop(0.35, `rgba(214,130,60,${0.04 * sunQ.dim})`); sp.addColorStop(1, "rgba(214,130,60,0)");
        s2.fillStyle = sp; s2.fillRect(sunQ.x - R, sunQ.y - R, R * 2, R * 2);
      }
      if (e < 0.98) {
        const refined = (P.orbitLines ?? "refined") === "refined";
        for (let i = 1; i < n; i++) {
          const o = st[i], ry = o.a * g.tilt, hot = hover === i;
          if (!refined) {
            s2.lineWidth = 1; s2.strokeStyle = `rgba(232,227,216,${(hot ? 0.28 : 0.1) * (1 - e)})`;
            s2.beginPath(); s2.ellipse(g.cx, g.cy, o.a, ry, o.rot, 0, Math.PI * 2); s2.stroke();
            continue;
          }
          // refined: hairline, warm-grey, quieter the further out it is, faint on the far side and stronger on the near side
          const far = o.rank / Math.max(1, n - 2), jitter = 0.8 + 0.4 * Math.abs(Math.sin(i * 7.31));
          const base = Math.min(0.3, (0.15 - 0.07 * far) * jitter * (hot ? 3.2 : 1)) * (1 - e);
          s2.save(); s2.translate(g.cx, g.cy); s2.rotate(o.rot);
          const lg = s2.createLinearGradient(0, -ry, 0, ry);
          lg.addColorStop(0, `rgba(214,206,190,${base * 0.15})`); lg.addColorStop(0.5, `rgba(214,206,190,${base * 0.55})`); lg.addColorStop(1, `rgba(214,206,190,${base})`);
          s2.lineWidth = 0.7; s2.strokeStyle = lg; s2.beginPath(); s2.ellipse(0, 0, o.a, ry, 0, 0, Math.PI * 2); s2.stroke(); s2.restore();
        }
      }

      // ── planets ──
      if (gl && prog) {
        gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.uRes, glc.width, glc.height);
        for (const q of placed) {
          // every planet is lit from the star at the centre; in the close-up view a fixed key light takes over
          let lx = FOCUS_LIGHT[0], ly = FOCUS_LIGHT[1], lz = FOCUS_LIGHT[2];
          if (sunQ && q.i !== 0) {
            const dx = sunQ.x - q.x, dy = q.y - sunQ.y, dl = Math.hypot(dx, dy) || 1;
            lx = lerp(0.8 * dx / dl, lx, e); ly = lerp(0.8 * dy / dl, ly, e); lz = lerp(0.62, lz, e);
          }
          gl.uniform3f(U.uLight, lx, ly, lz);
          const ring = q.type === 1 ? 1 : 0;   // one ringed world
          gl.uniform1f(U.uQuad, q.type === 0 ? 2.7 : ring > 0 ? 2.4 : 1.3); gl.uniform1f(U.uRing, ring); gl.uniform1f(U.uShade, q.shade);
          gl.uniform2f(U.uCenter, q.x * dpr, q.y * dpr); gl.uniform1f(U.uRad, q.r * dpr);
          gl.uniform1f(U.uTime, t); gl.uniform1f(U.uType, q.type); gl.uniform1f(U.uDim, q.dim);
          gl.uniform1f(U.uAA, 1.5 / Math.max(1, q.r * dpr)); gl.uniform1f(U.uSeed, q.seed ?? q.type * 3.7); gl.uniform3f(U.uTint, ...(q.tint ?? [1, 1, 1]));
          gl.uniform1f(U.uSpin, reduce ? 0 : q.type === 0 ? 0.02 : 0.03 + q.type * 0.004);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      } else {
        for (const q of placed) {
          const gr = s2.createRadialGradient(q.x - q.r * 0.35, q.y - q.r * 0.4, q.r * 0.1, q.x, q.y, q.r);
          gr.addColorStop(0, FALLBACK[q.type]); gr.addColorStop(1, "#0b0d10");
          s2.globalAlpha = q.dim; s2.fillStyle = gr; s2.beginPath(); s2.arc(q.x, q.y, q.r, 0, 7); s2.fill(); s2.globalAlpha = 1;
        }
      }

      // ── labels (system view only) ──
      f2.setTransform(dpr, 0, 0, dpr, 0, 0); f2.clearRect(0, 0, W, H);
      if (e < 0.9) {
        const a = 1 - e / 0.9;
        f2.textAlign = "center"; f2.shadowColor = "rgba(0,0,0,0.9)"; f2.shadowBlur = 8;
        for (const q of [...placed].sort((x, y) => Number(x.i === 0) - Number(y.i === 0))) {   // the star's label always sits on top
          const hot = hover === q.i;
          f2.globalAlpha = a * (hot ? 1 : 0.78);
          f2.fillStyle = "#ebe6da"; f2.font = `400 ${W < 520 ? 14 : 16}px ${FONT}`;
          (f2 as any).letterSpacing = "0.02em";
          const ly = q.y + q.r + (q.i === 0 ? 18 : 17);
          f2.fillText(q.label, q.x, ly);
          f2.fillStyle = "rgba(232,227,216,0.46)"; f2.font = `400 ${W < 520 ? 9.5 : 10.5}px ${UI}`;
          (f2 as any).letterSpacing = "0.08em";
          f2.fillText(q.sub, q.x, ly + 15);
          (f2 as any).letterSpacing = "0px";
        }
        f2.globalAlpha = 1; f2.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={host} className="absolute inset-0 touch-pan-y">
      <canvas ref={starRef} className="absolute inset-0" aria-hidden="true" />
      <canvas ref={glRef} className="absolute inset-0" aria-hidden="true" />
      <canvas ref={fxRef} className="absolute inset-0" aria-hidden="true" />
    </div>
  );
}
