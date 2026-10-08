import {
  ALLOWED_LOCALITIES,
  ALLOWED_PINS,
  DENIED_PINS,
  DENIED_PLACES,
  HOME_CITY_NAMES,
} from "./data/service-area";

export type AreaStatus = "in" | "out" | "unclear";

export interface AreaResult {
  status: AreaStatus;
  reason: string;
  matchedLocality?: string;
  matchedDenied?: string;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whole-word match on the spaced text; multi-word names also match when the
 * caller (or STT) runs them together ("vimannagar").
 */
function mentions(haystack: string, needle: string): boolean {
  const h = normalise(haystack);
  const n = normalise(needle);
  if (!n) return false;
  if (` ${h} `.includes(` ${n} `)) return true;
  if (n.includes(" ")) return h.replace(/ /g, "").includes(n.replace(/ /g, ""));
  return false;
}

function findAllowed(text: string): string | undefined {
  for (const entry of ALLOWED_LOCALITIES) {
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      if (mentions(text, name)) return entry.name;
    }
  }
  return undefined;
}

function findDenied(text: string): string | undefined {
  return DENIED_PLACES.find((place) => mentions(text, place));
}

/**
 * Hard rule: service area (Pune city + PCMC).
 *
 * - A recognised Pune/PCMC locality, or an allowlisted PIN → in.
 * - A denylisted place (Talegaon, Lonavala, Nashik, Mumbai, other cities) → out.
 * - A denylisted PIN with no locality given → out.
 * - Conflicts (allowed locality + denied PIN/place) and anything unrecognised → unclear.
 *   Unclear is never auto-declined: the agent asks once, then it goes to review.
 */
export function resolveServiceArea(input: {
  locality: string | null;
  pin: string | null;
  city: string | null;
}): AreaResult {
  const placeText = [input.locality, input.city].filter(Boolean).join(" ");
  const allowed = placeText ? findAllowed(placeText) : undefined;
  const denied = placeText ? findDenied(placeText) : undefined;
  const pin = input.pin?.trim() || null;
  const pinAllowed = pin ? pin in ALLOWED_PINS : false;
  const pinDenied = pin ? pin in DENIED_PINS : false;

  if (allowed && denied) {
    return {
      status: "unclear",
      reason: `Mentions both ${allowed} and ${denied}`,
      matchedLocality: allowed,
      matchedDenied: denied,
    };
  }
  if (denied) {
    return {
      status: "out",
      reason: `${denied} is outside Pune city and PCMC`,
      matchedDenied: denied,
    };
  }
  if (allowed) {
    if (pinDenied) {
      return {
        status: "unclear",
        reason: `Locality ${allowed} but PIN ${pin} is ${DENIED_PINS[pin!]}`,
        matchedLocality: allowed,
      };
    }
    return {
      status: "in",
      reason: `${allowed} is in the service area`,
      matchedLocality: allowed,
    };
  }
  if (pinAllowed) {
    return { status: "in", reason: `PIN ${pin} (${ALLOWED_PINS[pin!]}) is in the service area` };
  }
  if (pinDenied && !input.locality) {
    return { status: "out", reason: `PIN ${pin} is ${DENIED_PINS[pin!]}, outside the service area` };
  }

  const saidHomeCity =
    !!placeText && HOME_CITY_NAMES.some((name) => mentions(placeText, name));
  return {
    status: "unclear",
    reason: saidHomeCity
      ? "Pune mentioned but locality not recognised"
      : placeText || pin
        ? `Location not recognised: ${[placeText, pin].filter(Boolean).join(", ")}`
        : "No location given",
  };
}
