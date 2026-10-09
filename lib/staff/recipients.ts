/**
 * Who gets staff emails. Designers come from DESIGNER_EMAILS ("email:Name",
 * the same list that grants dashboard access). Each group can be overridden
 * with STAFF_EMAIL_* (comma-separated); otherwise it falls back to the founder.
 */
export type StaffGroup = "designers" | "admin" | "senior" | "helpdesk" | "ops";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function designerDirectory(): { email: string; name: string }[] {
  return list(process.env.DESIGNER_EMAILS)
    .map((entry) => {
      const [email, ...name] = entry.split(":");
      return { email: email.trim().toLowerCase(), name: name.join(":").trim() };
    })
    .filter((d) => d.email.includes("@"));
}

/** A designer's email by their name (exact, then first-name match). */
export function designerEmail(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const dir = designerDirectory().filter((d) => d.name);
  const hit =
    dir.find((d) => d.name.toLowerCase() === n) ??
    dir.find((d) => d.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  return hit?.email ?? null;
}

/** Name to credit for an action taken from an emailed link. */
export function staffNameFor(email: string): string {
  return designerDirectory().find((d) => d.email === email.toLowerCase())?.name || email;
}

export function groupEmails(group: StaffGroup): string[] {
  const founders = list(process.env.FOUNDER_EMAILS);
  const override = list(
    { designers: process.env.STAFF_EMAIL_DESIGNERS, admin: process.env.STAFF_EMAIL_ADMIN, senior: process.env.STAFF_EMAIL_SENIOR, helpdesk: process.env.STAFF_EMAIL_HELPDESK, ops: process.env.STAFF_EMAIL_OPS }[group],
  );
  if (override.length) return override;
  if (group === "designers") {
    const all = designerDirectory().map((d) => d.email);
    return all.length ? all : founders;
  }
  return founders;
}
