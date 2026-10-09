"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * A small wind chime docked in the corner of every dashboard page. It lives in the
 * dashboard layout, so it stays mounted (and keeps ringing) while pages switch and load.
 * Click a tube, or hold and drag across the tubes, to play it. The tubes are tuned to
 * C-major pentatonic, so any run of notes harmonises; each strike is a synthesised
 * tubular-bell tone (free-bar overtones 1 : 2.76 : 5.40 : 8.93) with a quiet fifth
 * beneath and a short shimmer. Web Audio only — no files.
 */

/** Longest tube = lowest note. `slot` is the tube's place left→right around the disc. */
const TUBES = [
  { name: "C5", hz: 523.25, slot: 0 },
  { name: "D5", hz: 587.33, slot: 2 },
  { name: "E5", hz: 659.25, slot: 4 },
  { name: "G5", hz: 783.99, slot: 1 },
  { name: "A5", hz: 880.0, slot: 3 },
  { name: "C6", hz: 1046.5, slot: 5 },
];
const PARTIALS = [
  { ratio: 1, gain: 1, decay: 3.2 },
  { ratio: 2.76, gain: 0.42, decay: 1.9 },
  { ratio: 5.4, gain: 0.2, decay: 1.1 },
  { ratio: 8.93, gain: 0.09, decay: 0.6 },
];
const MUTE_KEY = "aangan:chime-muted";

// Geometry (viewBox 0 0 80 150): disc centred at (40, 20). Tubes sit on a ring, evenly
// spaced left→right (so each one can be reached by a drag), alternating back and front.
const CX = 40;
const DISC_Y = 20;
const tubeGeom = TUBES.map((t, i) => {
  const c = -0.9 + t.slot * 0.36;
  const depth = (t.slot % 2 ? 1 : -1) * Math.sqrt(1 - c * c); // 1 = nearest the viewer
  return { ...t, index: i, x: CX + 26 * c, depth, top: 34 + depth * 3, len: 88 - i * 8.5, width: 4.6 + depth * 0.6 };
});
const backToFront = [...tubeGeom].sort((a, b) => a.depth - b.depth);

type Audio = { ctx: AudioContext; out: GainNode };

// One audio graph for the whole tab, so a remount never stacks contexts.
let sharedAudio: Audio | null = null;
function getAudio(): Audio | null {
  if (sharedAudio) return sharedAudio;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const out = ctx.createGain();
  out.gain.value = 0.22;
  // A light shimmer: a short feedback delay, filtered so it stays soft.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.19;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  out.connect(ctx.destination);
  out.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(ctx.destination);
  sharedAudio = { ctx, out };
  return sharedAudio;
}

function strike(a: Audio, hz: number, velocity = 1) {
  const { ctx, out } = a;
  const now = ctx.currentTime;
  const voice = (freq: number, level: number) => {
    for (const p of PARTIALS) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * p.ratio * (1 + (Math.random() - 0.5) * 0.002); // tiny detune, like real metal
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(level * p.gain * velocity, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + p.decay + 0.05);
    }
  };
  voice(hz, 0.5);
  voice(hz * (2 / 3), 0.12); // a quiet fifth below — the harmony under each note
}

// Mute preference: a per-browser convenience in localStorage, read as an external store.
const muteListeners = new Set<() => void>();
let fallbackMuted: boolean | null = null;
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable — the toggle still works for this tab */
  }
  fallbackMuted = muted;
  muteListeners.forEach((l) => l());
}
const subscribeMuted = (l: () => void) => {
  muteListeners.add(l);
  return () => muteListeners.delete(l);
};
const getMuted = () => fallbackMuted ?? readMuted();

export function WindChime() {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const lastHit = useRef<{ index: number; at: number }>({ index: -1, at: 0 });
  const muted = useSyncExternalStore(subscribeMuted, getMuted, () => false);
  const [swing, setSwing] = useState<number[]>(() => TUBES.map(() => 0));
  const [strikes, setStrikes] = useState(0);

  const play = useCallback(
    (index: number, velocity = 1) => {
      const now = performance.now();
      if (lastHit.current.index === index && now - lastHit.current.at < 120) return;
      lastHit.current = { index, at: now };
      setSwing((s) => s.map((v, i) => (i === index ? v + 1 : v)));
      setStrikes((n) => n + 1);
      if (muted) return;
      const a = getAudio();
      if (!a) return;
      if (a.ctx.state === "suspended") void a.ctx.resume();
      strike(a, TUBES[index].hz, velocity);
    },
    [muted],
  );

  const tubeAt = (clientX: number, clientY: number): number => {
    const el = document.elementFromPoint(clientX, clientY);
    const tube = el?.closest("[data-rod]");
    return tube ? Number(tube.getAttribute("data-rod")) : -1;
  };

  return (
    <div className="chime-dock has-tip" data-label="Wind chime" data-tip="Click a tube, or hold and drag across them to play">
      <svg
        ref={svgRef}
        className="chime-art"
        viewBox="0 0 80 150"
        role="group"
        aria-label="Wind chime — click or drag across the tubes to play"
        onPointerDown={(e) => {
          dragging.current = true;
          try {
            svgRef.current?.setPointerCapture(e.pointerId); // keep the drag even if the pointer leaves the chime
          } catch {
            /* pointer already gone — the strike below still plays */
          }
          const i = tubeAt(e.clientX, e.clientY);
          if (i >= 0) play(i, 1);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const i = tubeAt(e.clientX, e.clientY);
          if (i >= 0) play(i, Math.min(1, 0.55 + Math.abs(e.movementX) / 30));
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => (dragging.current = false)}
      >
        <defs>
          <linearGradient id="chime-tube" x1="0" x2="1">
            <stop offset="0" style={{ stopColor: "var(--chime-tube-edge)" }} />
            <stop offset="0.32" style={{ stopColor: "var(--chime-tube-shine)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--chime-tube)" }} />
            <stop offset="1" style={{ stopColor: "var(--chime-tube-edge)" }} />
          </linearGradient>
          <linearGradient id="chime-disc" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--chime-disc-top)" }} />
            <stop offset="1" style={{ stopColor: "var(--chime-disc-side)" }} />
          </linearGradient>
        </defs>

        <g className="chime-body">
          {/* hook and hanging cords */}
          <line x1={CX} y1="0" x2={CX} y2="7" className="chime-cord" />
          <line x1={CX} y1="7" x2={CX - 22} y2={DISC_Y} className="chime-cord" />
          <line x1={CX} y1="7" x2={CX + 22} y2={DISC_Y} className="chime-cord" />

          {/* top disc: side band, then the face */}
          <path d={`M${CX - 28} ${DISC_Y} v4 a28 6 0 0 0 56 0 v-4 z`} fill="url(#chime-disc)" />
          <ellipse cx={CX} cy={DISC_Y} rx="28" ry="6" className="chime-disc-face" />

          {/* centre cord, striker and wind sail */}
          <g key={strikes} className={strikes ? "chime-striker swinging" : "chime-striker"} style={{ transformOrigin: `${CX}px ${DISC_Y + 6}px` }}>
            <line x1={CX} y1={DISC_Y + 6} x2={CX} y2="122" className="chime-cord" />
            <ellipse cx={CX} cy="74" rx="8" ry="2.6" className="chime-striker-disc" />
            <rect x={CX - 6} y="122" width="12" height="24" rx="6" className="chime-sail" />
          </g>

          {backToFront.map((t) => (
            <g
              key={t.name}
              data-rod={t.index}
              className="chime-tube"
              role="button"
              tabIndex={0}
              aria-label={`Chime ${t.name}`}
              style={{ opacity: 0.72 + 0.28 * ((t.depth + 1) / 2) }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  play(t.index, 0.9);
                }
              }}
            >
              {/* re-keyed on each strike so the swing animation restarts */}
              <g key={swing[t.index]} className={swing[t.index] ? "swinging" : undefined} style={{ transformOrigin: `${t.x}px ${DISC_Y + 4 + t.depth * 5}px` }}>
                <line x1={t.x} y1={DISC_Y + 4 + t.depth * 5} x2={t.x} y2={t.top} className="chime-cord" />
                <rect x={t.x - t.width / 2} y={t.top} width={t.width} height={t.len} rx={t.width / 2} fill="url(#chime-tube)" />
                {/* generous invisible hit area so dragging across is easy */}
                <rect x={t.x - 4.7} y={t.top - 4} width="9.4" height={t.len + 8} fill="transparent" />
              </g>
            </g>
          ))}
        </g>
      </svg>
      <button
        type="button"
        className="chime-mute"
        onClick={() => writeMuted(!muted)}
        aria-pressed={muted}
        aria-label={muted ? "Unmute wind chime" : "Mute wind chime"}
        title={muted ? "Sound off — click to turn on" : "Sound on — click to mute"}
      >
        {muted ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            <path d="M17 9l4 6M21 9l-4 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
        )}
      </button>
    </div>
  );
}
