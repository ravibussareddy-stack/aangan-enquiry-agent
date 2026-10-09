/**
 * The voice brain in the cloud: a Neon Function (always reachable, permanent
 * wss:// URL, next to the database — no laptop or tunnel). Vaani's BYOL points at
 *   wss://<function-host>/chat/stream
 * and sends `Authorization: Bearer <BRAIN_AUTH_TOKEN>`.
 *
 * Deploy: `neon deploy --env .env.local` (declared in neon.ts).
 */
import { upgradeWebSocket } from "@neon/functions";
import { brainAuthorized, callIdFromPath, handleByolCall } from "../../lib/brain/byol";

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
    // Refuse before upgrading: a wrong or missing token never gets a socket.
    if (!brainAuthorized(request.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
    const { socket, response } = upgradeWebSocket(request);
    handleByolCall(socket, callIdFromPath(url.pathname));
    return response;
  },
};

export default brain;
