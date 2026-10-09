/**
 * The voice brain in the cloud: a Neon Function (always reachable, permanent
 * wss:// URL, next to the database — no laptop or tunnel). Vaani's BYOL points at
 *   wss://<function-host>/chat/stream
 * and sends `Authorization: Bearer <BRAIN_AUTH_TOKEN>`.
 *
 * Deploy: `neon deploy --env .env.local` (declared in neon.ts).
 */
import { upgradeWebSocket } from "@neon/functions";
import { brainAuthorized, callIdFromPath, handleByolCall, handleConnectionCheckOnly } from "../../lib/brain/byol";

// A long-lived isolate serves many calls: log stray errors instead of letting one crash every call on it.
process.on("unhandledRejection", (err) => console.error("[brain] unhandledRejection", err));
process.on("uncaughtException", (err) => console.error("[brain] uncaughtException", err));

const brain = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Diagnostics only — never logs the token itself.
    const auth = request.headers.get("authorization");
    console.log(
      `[brain] ${request.method} ${url.pathname} upgrade=${request.headers.get("upgrade") ?? "-"} ` +
        `auth=${auth ? `${auth.split(" ")[0]} (${auth.length} chars) ${brainAuthorized(auth) ? "match" : "NO MATCH"}` : "none"} ` +
        `protocol=${request.headers.get("sec-websocket-protocol") ?? "-"} ua=${(request.headers.get("user-agent") ?? "-").slice(0, 40)}`,
    );
    if (url.pathname === "/health") return Response.json({ ok: true, at: new Date().toISOString() });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Aangan voice brain — Vaani BYOL WebSocket at /chat/stream/<call_id>", { status: 426 });
    }
    const authHeader = request.headers.get("authorization");
    // A wrong token is refused outright.
    if (authHeader && !brainAuthorized(authHeader)) return new Response("unauthorized", { status: 401 });
    const { socket, response } = upgradeWebSocket(request);
    // No token: Vaani's browser-side "Test Connection" — connection check only, nothing else.
    if (!authHeader) handleConnectionCheckOnly(socket);
    else handleByolCall(socket, callIdFromPath(url.pathname));
    return response;
  },
};

export default brain;
