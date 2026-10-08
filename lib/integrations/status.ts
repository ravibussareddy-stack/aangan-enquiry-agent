/** Which integrations have keys set in this environment. Names only, never values. */
export interface IntegrationStatus {
  name: string;
  connected: boolean;
  /** What happens without it. */
  fallback: string;
  needs: string;
}

export function integrationStatus(): IntegrationStatus[] {
  const has = (...keys: string[]) => keys.every((k) => !!process.env[k]);
  return [
    { name: "HubSpot", connected: has("HUBSPOT_PRIVATE_APP_TOKEN"), fallback: "mock CRM (deals logged only)", needs: "HUBSPOT_PRIVATE_APP_TOKEN, HUBSPOT_CLIENT_SECRET, HUBSPOT_PORTAL_ID" },
    { name: "Telegram", connected: has("TELEGRAM_BOT_TOKEN"), fallback: "handoff notes logged to the console", needs: "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_*_CHAT_ID" },
    { name: "Cal.com", connected: has("CALCOM_API_KEY", "CALCOM_EVENT_TYPE_RESIDENTIAL"), fallback: "mock calendar", needs: "CALCOM_API_KEY, CALCOM_EVENT_TYPE_*, CALCOM_WEBHOOK_SECRET" },
    { name: "Resend", connected: has("RESEND_API_KEY", "DIGEST_FROM"), fallback: "digest not emailed", needs: "RESEND_API_KEY, DIGEST_FROM, DIGEST_TO" },
    { name: "Gemini", connected: has("GEMINI_API_KEYS") || has("GEMINI_API_KEY"), fallback: "no AI summary or extraction", needs: "GEMINI_API_KEYS" },
    { name: "Vaani (live calls)", connected: process.env.VOICE_PROVIDER === "vaani" && has("VAANI_API_KEY"), fallback: "simulated calls", needs: "VOICE_PROVIDER=vaani, VAANI_API_KEY, VAANI_AGENT_ID" },
  ];
}
