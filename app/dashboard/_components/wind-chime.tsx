"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * A small wind chime on every dashboard page. It lives in the dashboard layout, so it
 * stays mounted (and keeps ringing) while pages switch and load.
 *
 * Whatever tube you click, or however you drag across them, the chime plays the next
 * note of a melody — picked at random, and a new one after the last note or a pause —
 * so it always sounds like a tune. Melodies use only C-major pentatonic (C D E G A),
 * with a soft in-scale bass under the phrase starts and endings. Each note is a clean,
 * in-tune bell (harmonic overtones only) with a light shimmer. Web Audio only — no files.
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
type Note = "C5" | "D5" | "E5" | "G5" | "A5" | "C6";

/** Original pentatonic melodies; one is picked at random each time. */
const MELODIES: Note[][] = [
  ["E5", "G5", "A5", "G5", "E5", "D5", "C5", "D5", "E5", "G5", "E5"],
  ["C5", "D5", "E5", "G5", "A5", "G5", "E5", "D5", "C5"],
  ["A5", "G5", "E5", "G5", "A5", "C6", "A5", "G5", "E5", "D5", "E5"],
  ["G5", "E5", "D5", "C5", "D5", "E5", "G5", "A5", "G5"],
  ["C6", "A5", "G5", "A5", "G5", "E5", "D5", "E5", "C5"],
  ["D5", "E5", "G5", "E5", "D5", "C5", "D5", "G5", "E5", "D5", "C5"],
  ["E5", "E5", "G5", "A5", "A5", "G5", "E5", "D5", "C5", "D5", "C5"],
  ["G5", "A5", "C6", "A5", "G5", "E5", "G5", "D5", "E5", "C5"],
  ["C5", "E5", "G5", "C6", "A5", "G5", "E5", "G5", "D5", "C5"],
  ["A5", "C6", "A5", "G5", "E5", "D5", "E5", "G5", "A5", "G5", "C5"],
];
/** A soft bass under a note, chosen so it's always in the scale and consonant. */
const BASS: Record<Note, number> = { C5: 261.63, E5: 261.63, G5: 261.63, D5: 196.0, A5: 220.0, C6: 220.0 };
const NEW_TUNE_AFTER_MS = 6000;

/** Bell overtones: whole-number multiples only, so every note is exactly in tune. */
const PARTIALS = [
  { ratio: 1, gain: 1, decay: 2.8 },
  { ratio: 2, gain: 0.22, decay: 1.5 },
  { ratio: 3, gain: 0.07, decay: 0.8 },
  { ratio: 4, gain: 0.03, decay: 0.5 },
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

// The tune in progress, shared by the whole tab so a remount carries on mid-melody.
const tune = { melody: -1, pos: 0, at: 0 };
function nextNote(): { note: Note; first: boolean; last: boolean; beat: number } {
  const now = performance.now();
  if (tune.melody < 0 || tune.pos >= MELODIES[tune.melody].length || now - tune.at > NEW_TUNE_AFTER_MS) {
    let pick = Math.floor(Math.random() * MELODIES.length);
    if (pick === tune.melody) pick = (pick + 1 + Math.floor(Math.random() * (MELODIES.length - 1))) % MELODIES.length;
    tune.melody = pick;
    tune.pos = 0;
  }
  const melody = MELODIES[tune.melody];
  const beat = tune.pos++;
  tune.at = now;
  return { note: melody[beat], first: beat === 0, last: beat === melody.length - 1, beat };
}

type Audio = { ctx: AudioContext; out: GainNode };

// One audio graph for the whole tab, so a remount never stacks contexts.
let sharedAudio: Audio | null = null;
function getAudio(): Audio | null {
  if (sharedAudio) return sharedAudio;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const out = ctx.createGain();
  out.gain.value = 0.24;
  // A light shimmer: a short feedback delay, filtered so it stays soft.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.23;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  out.connect(ctx.destination);
  out.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(ctx.destination);
  sharedAudio = { ctx, out };
  return sharedAudio;
}

function bell(a: Audio, hz: number, level: number) {
  const { ctx, out } = a;
  const now = ctx.currentTime;
  for (const p of PARTIALS) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz * p.ratio;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level * p.gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
    osc.connect(g).connect(out);
    osc.start(now);
    osc.stop(now + p.decay + 0.05);
  }
}

/** One melody note, with a soft bass on phrase starts (every 4 notes) and a bass + fifth on the last. */
function playNote(a: Audio, n: { note: Note; first: boolean; last: boolean; beat: number }, velocity: number) {
  const hz = TUBES.find((t) => t.name === n.note)!.hz;
  bell(a, hz, 0.5 * velocity);
  const bass = BASS[n.note];
  if (n.last) {
    bell(a, bass, 0.2);
    bell(a, bass * 1.5, 0.12);
  } else if (n.first || n.beat % 4 === 0) {
    bell(a, bass, 0.16);
  }
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

  /** Any strike — whichever tube — plays the next note of the melody; that note's tube swings. */
  const play = useCallback(
    (hitIndex: number, velocity = 1) => {
      const now = performance.now();
      if (lastHit.current.index === hitIndex && now - lastHit.current.at < 120) return;
      lastHit.current = { index: hitIndex, at: now };
      const n = nextNote();
      const sounding = TUBES.findIndex((t) => t.name === n.note);
      setSwing((s) => s.map((v, i) => (i === sounding ? v + 1 : v)));
      setStrikes((k) => k + 1);
      if (muted) return;
      const a = getAudio();
      if (!a) return;
      if (a.ctx.state === "suspended") void a.ctx.resume();
      playNote(a, n, velocity);
    },
    [muted],
  );

  const tubeAt = (clientX: number, clientY: number): number => {
    const el = document.elementFromPoint(clientX, clientY);
    const tube = el?.closest("[data-rod]");
    return tube ? Number(tube.getAttribute("data-rod")) : -1;
  };

  return (
    <div className="chime-dock has-tip" data-label="Wind chime" data-tip="Click or drag across the tubes — it plays a random melody">
      <svg
        ref={svgRef}
        className="chime-art"
        viewBox="0 0 80 150"
        role="group"
        aria-label="Wind chime — click or drag across the tubes to play a melody"
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
