import { SimulatedVoiceProvider } from "./simulated";
import type { VoiceProvider } from "./types";
import { VaaniProvider } from "./vaani";

/** Simulated unless VOICE_PROVIDER=vaani is set explicitly (real calls spend credit). */
export function getVoiceProvider(): VoiceProvider {
  return process.env.VOICE_PROVIDER === "vaani" ? new VaaniProvider() : new SimulatedVoiceProvider();
}

export * from "./types";
