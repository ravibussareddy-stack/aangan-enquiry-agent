"use server";

import { activeGreeting } from "@/agent/prompt";
import { getViewer } from "@/lib/auth/viewer";
import { startVaaniWebSession } from "@/lib/voice/vaani";

/** Founder only. Starts a Vaani browser session (spends voice credit; capped). */
export async function startTestCall(): Promise<{ ok: true; token: string; url: string; room: string } | { ok: false; error: string }> {
  const v = await getViewer();
  if (!v || v.role !== "founder") return { ok: false, error: "Founder only" };
  try {
    return { ok: true, ...(await startVaaniWebSession({ greeting: activeGreeting() })) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
