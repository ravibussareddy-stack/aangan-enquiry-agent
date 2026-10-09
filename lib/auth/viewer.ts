/**
 * The signed-in dashboard user and their role. Roles live in `profiles`;
 * on first sign-in an email listed in FOUNDER_EMAILS becomes founder and one in
 * DESIGNER_EMAILS ("email:Designer Name") becomes that designer, and one in
 * FRONTDESK_EMAILS becomes front desk. Everyone else has no access.
 */
import { connection } from "next/server";
import { cache } from "react";
import { db } from "../db/client";
import { auth } from "./server";

export interface Viewer {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  designerId: string | null;
}

export type Role = "founder" | "designer" | "frontdesk";

function listed(envVar: string) {
  return (process.env[envVar] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Local preview only: with DEV_VIEWER_ROLE=founder under `next dev`, pages render
 * without a login. Ignored whenever NODE_ENV is not "development".
 */
export function devViewerEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_VIEWER_ROLE === "founder";
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  await connection(); // request-time only: never prerender a signed-in view
  if (devViewerEnabled()) {
    const id = "dev-preview-founder";
    await db().query("insert into profiles (user_id, role) values ($1, 'founder') on conflict do nothing", [id]);
    return { userId: id, email: "preview@localhost", name: "Local preview", role: "founder", designerId: null };
  }
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const email = user.email.toLowerCase();

  let { rows } = await db().query<{ role: Role; designer_id: string | null }>(
    "select role, designer_id from profiles where user_id = $1",
    [user.id],
  );
  if (!rows[0]) {
    if (listed("FOUNDER_EMAILS").map((e) => e.toLowerCase()).includes(email)) {
      await db().query("insert into profiles (user_id, role) values ($1, 'founder') on conflict do nothing", [user.id]);
    } else if (listed("FRONTDESK_EMAILS").map((e) => e.toLowerCase()).includes(email)) {
      await db().query("insert into profiles (user_id, role) values ($1, 'frontdesk') on conflict do nothing", [user.id]);
    } else {
      const entry = listed("DESIGNER_EMAILS").find((e) => e.split(":")[0].toLowerCase() === email);
      if (!entry) return { userId: user.id, email, name: user.name ?? null, role: "designer", designerId: null }; // no access (see hasAccess)
      const designerName = entry.split(":").slice(1).join(":") || user.name || email;
      const d = await db().query<{ id: string }>(
        `with existing as (select id from designers where name = $1),
              created as (insert into designers (name) select $1 where not exists (select 1 from existing) returning id)
         select id from existing union all select id from created`,
        [designerName],
      );
      await db().query("insert into profiles (user_id, role, designer_id) values ($1, 'designer', $2) on conflict do nothing", [user.id, d.rows[0].id]);
    }
    rows = (await db().query<{ role: Role; designer_id: string | null }>("select role, designer_id from profiles where user_id = $1", [user.id])).rows;
  }
  return { userId: user.id, email, name: user.name ?? null, role: rows[0].role, designerId: rows[0].designer_id };
});

/** Has a role (founder, front desk, or a designer linked to a designer record). */
export function hasAccess(v: Viewer | null): boolean {
  return !!v && (v.role === "founder" || v.role === "frontdesk" || !!v.designerId);
}

/** Where each role lands. */
export function homeFor(v: Viewer): string {
  return v.role === "founder" ? "/dashboard" : v.role === "frontdesk" ? "/dashboard/desk" : "/dashboard/designer";
}
