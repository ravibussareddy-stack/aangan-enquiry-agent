/**
 * Local dev server for the voice brain. Production runs on a Neon Function
 * (functions/brain) — this is for offline work and the rehearsal script.
 *
 *   npm run brain            # listens on BRAIN_PORT (default 8090)
 *
 * Same handler as the cloud (lib/brain/byol.ts). Costs no Vaani credit by itself.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import { brainAuthorized, callIdFromPath, handleByolCall, type CallSocket } from "../lib/brain/byol";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.BRAIN_PORT ?? 8090);

const http = createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: req.url === "/health" }));
});
const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  if (!brainAuthorized(req.headers.authorization)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const callId = callIdFromPath((req.url ?? "").split("?")[0]);
  wss.handleUpgrade(req, socket, head, (ws) => handleByolCall(ws as unknown as CallSocket, callId));
});

http.listen(PORT, () => console.log(`[brain] BYOL WebSocket server on :${PORT} (path /chat/stream/<call_id>)`));
