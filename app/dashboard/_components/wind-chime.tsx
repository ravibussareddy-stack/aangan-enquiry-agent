"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * A small glass wind chime. Click a rod, or hold and drag across the rods, to play
 * it. The rods are tuned to C-major pentatonic, so any run of notes harmonises; each
 * strike is a synthesised tubular-bell tone (free-bar overtones 1 : 2.76 : 5.40 : 8.93)
 * with a quiet fifth beneath and a short shimmer. Web Audio only — no files.
 */

const NOTES = [
  { name: "C5", hz: 523.25 },
  { name: "D5", hz: 587.33 },
  { name: "E5", hz: 659.25 },
  { name: "G5", hz: 783.99 },
  { name: "A5", hz: 880.0 },
  { name: "C6", hz: 1046.5 },
  { name: "D6", hz: 1174.66 },
];
const PARTIALS = [
  { ratio: 1, gain: 1, decay: 3.2 },
  { ratio: 2.76, gain: 0.42, decay: 1.9 },
  { ratio: 5.4, gain: 0.2, decay: 1.1 },
  { ratio: 8.93, gain: 0.09, decay: 0.6 },
];
const MUTE_KEY = "aangan:chime-muted";

type Audio = { ctx: AudioContext; out: GainNode };

// Mute preference: a per-browser convenience in localStorage, read as an external store.
const muteListeners = new Set<() => void>();
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
    /* storage unavailable — the toggle still works for this page */
  }
  fallbackMuted = muted;
  muteListeners.forEach((l) => l());
}
let fallbackMuted: boolean | null = null;
const subscribeMuted = (l: () => void) => {
  muteListeners.add(l);
  return () => muteListeners.delete(l);
};
const getMuted = () => fallbackMuted ?? readMuted();

function makeAudio(): Audio | null {
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
  return { ctx, out };
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

export function WindChime() {
  const audio = useRef<Audio | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const lastHit = useRef<{ index: number; at: number }>({ index: -1, at: 0 });
  const muted = useSyncExternalStore(subscribeMuted, getMuted, () => false);
  const [swing, setSwing] = useState<number[]>(() => NOTES.map(() => 0));

  const play = useCallback(
    (index: number, velocity = 1) => {
      const now = performance.now();
      if (lastHit.current.index === index && now - lastHit.current.at < 120) return;
      lastHit.current = { index, at: now };
      setSwing((s) => s.map((v, i) => (i === index ? v + 1 : v)));
      if (muted) return;
      if (!audio.current) audio.current = makeAudio();
      const a = audio.current;
      if (!a) return;
      if (a.ctx.state === "suspended") void a.ctx.resume();
      strike(a, NOTES[index].hz, velocity);
    },
    [muted],
  );

  const rodAt = (clientX: number, clientY: number): number => {
    const el = document.elementFromPoint(clientX, clientY);
    const rod = el?.closest("[data-rod]");
    return rod ? Number(rod.getAttribute("data-rod")) : -1;
  };

  const toggleMute = () => writeMuted(!muted);

  return (
    <div className="chime" aria-label="Wind chime — click or drag across the rods to play">
      <svg
        ref={svgRef}
        viewBox="0 0 196 92"
        width="196"
        height="92"
        role="group"
        aria-label="Wind chime"
        onPointerDown={(e) => {
          dragging.current = true;
          svgRef.current?.setPointerCapture(e.pointerId);
          const i = rodAt(e.clientX, e.clientY);
          if (i >= 0) play(i, 1);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const i = rodAt(e.clientX, e.clientY);
          if (i >= 0) play(i, Math.min(1, 0.55 + Math.abs(e.movementX) / 30));
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          svgRef.current?.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => (dragging.current = false)}
      >
        <defs>
          <linearGradient id="chime-rod" x1="0" x2="1">
            <stop offset="0" stopColor="#eef1ff" />
            <stop offset="0.4" stopColor="#a9b6ff" />
            <stop offset="1" stopColor="#5b6be0" />
          </linearGradient>
          <linearGradient id="chime-bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#c7cffc" />
            <stop offset="1" stopColor="#6574dc" />
          </linearGradient>
        </defs>
        <rect x="8" y="4" width="180" height="7" rx="3.5" fill="url(#chime-bar)" stroke="rgb(255 255 255 / 0.8)" />
        {NOTES.map((n, i) => {
          const x = 20 + i * 26;
          const len = 74 - i * 6.5;
          return (
            <g
              key={n.name}
              data-rod={i}
              className="chime-rod"
              style={{ transformOrigin: `${x}px 11px` }}
              data-swing={swing[i] % 2}
              role="button"
              tabIndex={0}
              aria-label={`Chime ${n.name}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  play(i, 0.9);
                }
              }}
            >
              {/* re-keyed on each strike so the swing animation restarts */}
              <g key={swing[i]} className={swing[i] ? "swinging" : undefined} style={{ transformOrigin: `${x}px 11px` }}>
                <line x1={x} y1="11" x2={x} y2="16" stroke="rgb(80 90 170 / 0.8)" strokeWidth="1.2" />
                <rect x={x - 5} y="16" width="10" height={len} rx="5" fill="url(#chime-rod)" stroke="rgb(70 80 180 / 0.45)" strokeWidth="0.8" />
                <rect x={x - 2.5} y="19" width="2" height={len - 8} rx="1" fill="rgb(255 255 255 / 0.7)" />
                {/* generous invisible hit area so dragging across is easy */}
                <rect x={x - 12} y="11" width="24" height={len + 8} fill="transparent" />
              </g>
            </g>
          );
        })}
      </svg>
      <button
        type="button"
        className="chime-mute has-tip"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Unmute wind chime" : "Mute wind chime"}
        data-label={muted ? "Sound off" : "Sound on"}
        data-tip="Click or drag across the rods to play"
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
