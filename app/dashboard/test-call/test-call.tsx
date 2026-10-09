"use client";

import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { startTestCall } from "./actions";

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

/** Joins the Vaani WebRTC room with the mic on and plays the agent's audio. */
export function TestCall({ limitS }: { limitS: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const room = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setElapsed(s);
      // Safety net: never leave a session running past the limit (+5 s for the goodbye).
      if (s > limitS + 5) void hangUp();
    }, 500);
    return () => clearInterval(t);
  }, [phase, limitS]);

  useEffect(() => () => void room.current?.disconnect(), []);

  async function start() {
    setPhase("connecting");
    setError(null);
    setElapsed(0);
    const res = await startTestCall();
    if (!res.ok) {
      setError(res.error);
      setPhase("error");
      return;
    }
    const r = new Room();
    room.current = r;
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) audio.current?.appendChild(track.attach());
    });
    r.on(RoomEvent.Disconnected, () => {
      setPhase((p) => (p === "error" ? p : "ended"));
      audio.current?.replaceChildren();
    });
    try {
      await r.connect(res.url, res.token);
      await r.localParticipant.setMicrophoneEnabled(true);
      setPhase("live");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
      await r.disconnect();
    }
  }

  async function hangUp() {
    await room.current?.disconnect();
    room.current = null;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="stat-big" aria-live="polite">
        {phase === "live" ? `0:${String(elapsed).padStart(2, "0")}` : phase === "connecting" ? "Connecting…" : phase === "ended" ? "Call ended" : "Ready"}
        <span className="muted small"> · limit {limitS}s</span>
      </div>
      <div className="meter" role="img" aria-label="Call time used">
        <span style={{ width: `${Math.min(100, (elapsed / limitS) * 100)}%` }} />
      </div>
      <div className="row">
        {phase === "live" || phase === "connecting" ? (
          <button className="pill ink" onClick={hangUp} disabled={phase === "connecting"}>Hang up</button>
        ) : (
          <button className="pill ink" onClick={start}>{phase === "ended" ? "Call again" : "Start test call"}</button>
        )}
        {phase === "live" && <span className="muted small">Mic on — speak as the customer.</span>}
      </div>
      {error && <p className="error">{error}</p>}
      <div ref={audio} hidden />
    </div>
  );
}
