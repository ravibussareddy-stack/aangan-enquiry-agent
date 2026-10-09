import { defineConfig } from "@neon/config/v1";

/**
 * Neon infrastructure as code. Apply with `neon deploy --env .env.local`
 * (values below are read from that file at deploy time; DATABASE_URL is injected by Neon).
 *
 * - Managed Auth (Better Auth) for the founder/designer/front desk dashboard login.
 * - `brain`: the Vaani BYOL voice brain as a Neon Function — a permanent wss:// URL
 *   in the cloud, next to the database (no laptop, no tunnel).
 */
const env = (key: string) => process.env[key]!;

export default defineConfig({
  auth: true,
  functions: {
    brain: {
      name: "aangan voice brain",
      source: "functions/brain/index.ts",
      env: {
        BRAIN_AUTH_TOKEN: env("BRAIN_AUTH_TOKEN"),
        BRAIN_DEBUG: "1",
        VOICE_PROVIDER: env("VOICE_PROVIDER"),
        QUICK_TEST: env("QUICK_TEST"),
        QUICK_TEST_MINUTES: env("QUICK_TEST_MINUTES"),
        APP_BASE_URL: env("APP_BASE_URL"),
        GEMINI_API_KEYS: env("GEMINI_API_KEYS"),
        GEMINI_MODEL: env("GEMINI_MODEL"),
        GEMINI_DIALOGUE_MODEL: env("GEMINI_DIALOGUE_MODEL"),
        HUBSPOT_PRIVATE_APP_TOKEN: env("HUBSPOT_PRIVATE_APP_TOKEN"),
        HUBSPOT_PORTAL_ID: env("HUBSPOT_PORTAL_ID"),
        CALCOM_API_KEY: env("CALCOM_API_KEY"),
        CALCOM_EVENT_TYPE_RESIDENTIAL: env("CALCOM_EVENT_TYPE_RESIDENTIAL"),
        CALCOM_EVENT_TYPE_COMMERCIAL: env("CALCOM_EVENT_TYPE_COMMERCIAL"),
        CALCOM_EVENT_TYPE_SITE_VISIT: env("CALCOM_EVENT_TYPE_SITE_VISIT"),
        GMAIL_USER: env("GMAIL_USER"),
        GMAIL_APP_PASSWORD: env("GMAIL_APP_PASSWORD"),
        FOUNDER_EMAILS: env("FOUNDER_EMAILS"),
        DESIGNER_EMAILS: env("DESIGNER_EMAILS"),
        SMS_PROVIDER: env("SMS_PROVIDER"),
      },
    },
  },
});
