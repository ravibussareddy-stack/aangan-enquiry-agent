/** Normalise an Indian phone number to E.164 (+91XXXXXXXXXX). Returns null if it can't. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  const d = digits.replace(/^\+/, "");
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `+91${d}`;
  return null;
}

/** National number without country code — HubSpot phone search matches on this. */
export function nationalNumber(e164: string): string {
  return e164.replace(/^\+91/, "");
}

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 5)}•••••${e164.slice(-3)}` : e164;
}
