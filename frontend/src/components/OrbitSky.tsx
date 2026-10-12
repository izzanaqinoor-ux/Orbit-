import { useEffect, useRef } from "react";
import type { Category } from "../types";

export interface Moon { id: string; title: string; minutes: number }
export interface Planet {
  key: Category;
  label: string;
  color: string;          // #rrggbb
  minutes: number;        // scheduled + waiting — drives planet size
  urgentAt: number | null; // earliest open deadline (ms) — drives orbit distance
  pressure: boolean;      // a deadline this week still has unplanned work
  moons: Moon[];
}
export interface SkyProps {
  planets: Planet[];
  sunNote: string;        // small text under the sun, e.g. "37h free"
  overCapacity: boolean;
  selected: Category | null;
  onSelect: (k: Category | null) => void;
}

type RGB = [number, number, number];
const toRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c: RGB, to: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(c[i] + (to[i] - c[i]) * t)) as RGB;
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [0, 0, 0];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const hrs = (m: number) => (m >= 60 ? `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)}h` : `${Math.round(m)}m`);

interface PState { angle: number; r: number; a: number; speed: number; moonAngle: number[] }
interface Hit { kind: "planet" | "moon"; key: Category; x: number; y: number; r: number; title?: string; minutes?: number }

export function OrbitSky(props: SkyProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const cv = canvas.current!, host = wrap.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();
    const ptr = { x: -1, y: -1 };
    let hits: Hit[] = [];
    let hovered: Hit | null = null;
    const states = new Map<Category, PState>();
    const startAngle: Record<string, number> = { study: 0.6, work: 2.5, personal: 4.2, other: 5.5 };
    const stars = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.2 + 0.3, p: Math.random() * 6.28, f: 0.4 + Math.random() * 1.4 }));
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

    const resize = () => {
      const r = host.getBoundingClientRect();
      W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + "px"; cv.style.height = H + "px";
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);

    const onMove = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; };
    const onLeave = () => { ptr.x = -1; ptr.y = -1; };
    const onClick = () => {
      if (!hovered) return live.current.onSelect(null);
      const k = hovered.key;
      live.current.onSelect(live.current.selected === k ? null : k);
    };
    cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerdown", onMove);
    cv.addEventListener("pointerleave", onLeave); cv.addEventListener("click", onClick);

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = now / 1000, P = live.current;
      const motion = reduce ? 0.12 : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2, m = Math.min(W, H);
      const tilt = W < 520 ? 0.62 : 0.5;
      const sunR = m * 0.052, Rmax = m * (W < 520 ? 0.075 : 0.088), Rmin = Rmax * 0.3;
      const aMin = (sunR * 1.45 + Rmax * 1.1) / tilt;
      const aMax = Math.max(aMin + 40, Math.min(W / 2 - Rmax - 10, (H / 2 - Rmax - 34) / tilt));
      const maxMin = Math.max(1, ...P.planets.map((p) => p.minutes));

      // ── stars ──
      for (const s of stars) {
        const tw = reduce ? 0.7 : 0.55 + 0.45 * Math.sin(t * s.f + s.p);
        ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * tw * (s.s / 1.5)})`;
        ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
      if (!reduce) {
        if (!shoot && Math.random() < dt / 9) shoot = { x: Math.random() * W * 0.7, y: Math.random() * H * 0.35, vx: 420, vy: 170, life: 1 };
        if (shoot) {
          shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt; shoot.life -= dt * 1.4;
          const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 0.12, shoot.y - shoot.vy * 0.12);
          g.addColorStop(0, `rgba(255,255,255,${Math.max(0, shoot.life)})`); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 0.12, shoot.y - shoot.vy * 0.12); ctx.stroke();
          if (shoot.life <= 0) shoot = null;
        }
      }

      // ── layout targets: closer orbit = sooner deadline ──
      const order = [...P.planets].sort((a, b) => (a.urgentAt ?? Infinity) - (b.urgentAt ?? Infinity) || b.minutes - a.minutes);
      const n = Math.max(1, order.length - 1);
      const items = P.planets.map((pl) => {
        let st = states.get(pl.key);
        const rank = order.indexOf(pl);
        const tgtA = aMin + ((aMax - aMin) * rank) / n;
        const tgtR = pl.minutes <= 0 ? Rmin * 0.75 : Rmin + (Rmax - Rmin) * Math.sqrt(pl.minutes / maxMin);
        if (!st) { st = { angle: startAngle[pl.key] ?? 0, r: tgtR, a: tgtA, speed: 1, moonAngle: [] }; states.set(pl.key, st); }
        const k = 1 - Math.exp(-dt * 3.2);
        st.r = lerp(st.r, tgtR, k); st.a = lerp(st.a, tgtA, k);
        const slow = hovered?.key === pl.key || P.selected === pl.key ? 0.1 : 1;
        st.speed = lerp(st.speed, slow, 1 - Math.exp(-dt * 5));
        st.angle += ((Math.PI * 2) / 46) * Math.pow(aMin / st.a, 1.5) * 1.4 * st.speed * motion * dt;
        const x = cx + st.a * Math.cos(st.angle), y = cy + st.a * tilt * Math.sin(st.angle);
        return { pl, st, x, y, depth: Math.sin(st.angle) };
      });

      // ── orbit paths ──
      ctx.lineWidth = 1;
      for (const it of items) {
        ctx.strokeStyle = P.selected === it.pl.key ? rgba(toRGB(it.pl.color), 0.38) : "rgba(255,255,255,0.09)";
        ctx.beginPath(); ctx.ellipse(cx, cy, it.st.a, it.st.a * tilt, 0, 0, Math.PI * 2); ctx.stroke();
      }

      const newHits: Hit[] = [];
      const drawSun = () => {
        const pulse = reduce ? 1 : 1 + 0.05 * Math.sin(t * 1.4);
        const hot: RGB = P.overCapacity ? [255, 90, 70] : [255, 176, 60];
        const g = ctx.createRadialGradient(cx, cy, sunR * 0.5, cx, cy, sunR * 5 * pulse);
        g.addColorStop(0, rgba(hot, 0.6)); g.addColorStop(0.22, rgba(hot, 0.22)); g.addColorStop(1, rgba(hot, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, sunR * 5 * pulse, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.05 * motion);
        for (let i = 0; i < 14; i++) {
          ctx.rotate((Math.PI * 2) / 14);
          const L = sunR * (2.4 + 0.9 * Math.sin(i * 2.1 + t * 0.8 * motion));
          const lg = ctx.createLinearGradient(sunR, 0, L + sunR, 0);
          lg.addColorStop(0, rgba(hot, 0.28)); lg.addColorStop(1, rgba(hot, 0));
          ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sunR, 0); ctx.lineTo(L + sunR, 0); ctx.stroke();
        }
        ctx.restore();
        const core = ctx.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, sunR * 0.1, cx, cy, sunR);
        core.addColorStop(0, "#fff8dc"); core.addColorStop(0.55, P.overCapacity ? "#ff9a70" : "#ffc247"); core.addColorStop(1, P.overCapacity ? "#e0452f" : "#f08a1c");
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, sunR, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(60,25,0,0.78)"; ctx.font = `700 ${Math.max(9, sunR * 0.4)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("YOU", cx, cy + 0.5);
      };

      const drawPlanet = (it: (typeof items)[number]) => {
        const { pl, st } = it, col = toRGB(pl.color);
        const sc = 0.9 + 0.1 * it.depth, r = st.r * sc;
        const { x, y } = it;
        const isHover = hovered?.kind === "planet" && hovered.key === pl.key;
        const dxs = cx - x, dys = cy - y, dl = Math.hypot(dxs, dys) || 1, ux = dxs / dl, uy = dys / dl;
        // atmosphere
        const gl = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * (isHover ? 2.5 : 2.1));
        gl.addColorStop(0, rgba(col, 0.32)); gl.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, 7); ctx.fill();
        // moon paths
        const mn = pl.moons.slice(0, 6);
        const maxMoon = Math.max(1, ...mn.map((q) => q.minutes));
        mn.forEach((_q, i) => {
          const mr = r * 1.7 + i * Math.max(5, r * 0.34);
          ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.ellipse(x, y, mr, mr * tilt * 1.15, 0, 0, 7); ctx.stroke();
          if (st.moonAngle[i] === undefined) st.moonAngle[i] = i * 1.9;
          st.moonAngle[i] += (1.5 / (1 + i * 0.45)) * st.speed * motion * dt;
        });
        // ring (back half)
        const ringRx = r * 1.95, ringRy = r * 0.5, rot = -0.3;
        const ring = (a0: number, a1: number) => {
          ctx.strokeStyle = rgba(mix(col, WHITE, 0.45), 0.55); ctx.lineWidth = Math.max(2, r * 0.24);
          ctx.beginPath(); ctx.ellipse(x, y, ringRx, ringRy, rot, a0, a1); ctx.stroke();
          ctx.strokeStyle = rgba(mix(col, WHITE, 0.7), 0.5); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(x, y, ringRx * 1.12, ringRy * 1.12, rot, a0, a1); ctx.stroke();
        };
        if (pl.key === "study") ring(Math.PI, Math.PI * 2);
        // body
        const body = ctx.createRadialGradient(x + ux * r * 0.55, y + uy * r * 0.55, r * 0.08, x, y, r * 1.15);
        body.addColorStop(0, rgba(mix(col, WHITE, 0.55), 1)); body.addColorStop(0.45, rgba(col, 1)); body.addColorStop(1, rgba(mix(col, BLACK, 0.82), 1));
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
        if (pl.key === "work") {
          for (let i = -3; i <= 3; i++) { ctx.fillStyle = `rgba(${i % 2 ? "90,30,0" : "255,220,170"},${i % 2 ? 0.22 : 0.16})`; ctx.fillRect(x - r, y + i * r * 0.27 - r * 0.07, r * 2, r * 0.15); }
        } else if (pl.key === "personal") {
          ctx.fillStyle = "rgba(20,80,160,0.35)"; ctx.beginPath(); ctx.ellipse(x - r * 0.25, y + r * 0.1, r * 0.55, r * 0.32, 0.5, 0, 7); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.beginPath(); ctx.ellipse(x + r * 0.3, y - r * 0.35, r * 0.4, r * 0.1, -0.2, 0, 7); ctx.fill();
        } else if (pl.key === "other") {
          [[-0.3, -0.2, 0.2], [0.25, 0.25, 0.28], [0.1, -0.5, 0.12]].forEach(([a, b, c]) => { ctx.fillStyle = "rgba(30,20,60,0.3)"; ctx.beginPath(); ctx.arc(x + a * r, y + b * r, c * r, 0, 7); ctx.fill(); });
        }
        // night side
        const ns = ctx.createLinearGradient(x + ux * r, y + uy * r, x - ux * r, y - uy * r);
        ns.addColorStop(0.45, "rgba(0,0,10,0)"); ns.addColorStop(1, "rgba(0,0,10,0.6)");
        ctx.fillStyle = ns; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
        if (pl.key === "study") ring(0, Math.PI);
        // deadline pressure
        if (pl.pressure) {
          const a = reduce ? 0.7 : 0.45 + 0.4 * Math.sin(t * 3);
          ctx.strokeStyle = `rgba(255,190,70,${a})`; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
          ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        }
        if (P.selected === pl.key) { ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * 1.28, 0, 7); ctx.stroke(); }
        newHits.push({ kind: "planet", key: pl.key, x, y, r: Math.max(r * 1.2, 14) });
        // moons
        mn.forEach((q, i) => {
          const mr = r * 1.7 + i * Math.max(5, r * 0.34), ang = st.moonAngle[i];
          const mrad = Math.max(2.6, Math.min(r * 0.34, r * 0.34 * Math.sqrt(q.minutes / maxMoon)));
          const mx = x + mr * Math.cos(ang), my = y + mr * tilt * 1.15 * Math.sin(ang);
          const mg = ctx.createRadialGradient(mx - mrad * 0.3, my - mrad * 0.3, mrad * 0.1, mx, my, mrad);
          mg.addColorStop(0, "#ffffff"); mg.addColorStop(1, rgba(mix(col, BLACK, 0.35), 1));
          ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mrad, 0, 7); ctx.fill();
          newHits.push({ kind: "moon", key: pl.key, x: mx, y: my, r: Math.max(mrad + 3, 7), title: q.title, minutes: q.minutes });
        });
        // label
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(pl.label, x, y + r * (pl.key === "study" ? 1.6 : 1.3) + 14);
        ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(hrs(pl.minutes), x, y + r * (pl.key === "study" ? 1.6 : 1.3) + 28);
        ctx.shadowBlur = 0;
      };

      const behind = items.filter((i) => i.depth < 0).sort((a, b) => a.depth - b.depth);
      const front = items.filter((i) => i.depth >= 0).sort((a, b) => a.depth - b.depth);
      behind.forEach(drawPlanet); drawSun(); front.forEach(drawPlanet);

      // ── hit testing (moons first) ──
      hits = newHits;
      hovered = null;
      if (ptr.x >= 0) {
        const pick = (kind: Hit["kind"]) => hits.filter((h) => h.kind === kind && Math.hypot(h.x - ptr.x, h.y - ptr.y) <= h.r).sort((a, b) => a.r - b.r)[0];
        hovered = pick("moon") ?? pick("planet") ?? null;
      }
      cv.style.cursor = hovered ? "pointer" : "default";
      if (hovered?.kind === "moon") {
        const text = `${hovered.title} · ${hrs(hovered.minutes ?? 0)}`;
        ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
        const w = ctx.measureText(text).width + 16, bx = Math.min(Math.max(ptr.x + 12, 4), W - w - 4), by = Math.max(ptr.y - 34, 4);
        ctx.fillStyle = "rgba(10,12,28,0.92)"; ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath(); ctx.roundRect(bx, by, w, 24, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, bx + 8, by + 12);
      }
      // sun note
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = P.overCapacity ? "rgba(255,150,130,0.95)" : "rgba(255,220,150,0.85)";
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif"; ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6;
      ctx.fillText(P.sunNote, cx, cy + sunR * 1.55 + 12); ctx.shadowBlur = 0;

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerdown", onMove);
      cv.removeEventListener("pointerleave", onLeave); cv.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div ref={wrap} className="h-full w-full">
      <canvas ref={canvas} role="img" aria-label="Your commitments as planets orbiting you, the sun. Larger planets hold more time." className="block touch-manipulation" />
    </div>
  );
}
