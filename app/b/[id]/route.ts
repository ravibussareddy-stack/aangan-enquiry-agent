/**
 * Short booking link sent by SMS after approval calls fail (/b/<lead id>).
 * Served from the studio's own (DLT-whitelistable) domain and redirected to
 * the Cal.com booking page with the lead reference attached.
 */
import { NextResponse } from "next/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const target = process.env.CALCOM_BOOKING_URL;
  if (!target || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Please call Aangan Studio to book.", { status: 404 });
  const url = new URL(target);
  url.searchParams.set("metadata[lead_ref]", id);
  return NextResponse.redirect(url, 302);
}
