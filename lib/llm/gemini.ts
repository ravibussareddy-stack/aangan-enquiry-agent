/**
 * Minimal Gemini REST client (generateContent).
 *
 * - Keys from GEMINI_API_KEYS (comma-separated, fallback order) or GEMINI_API_KEY.
 *   A key that is rejected (401/403) is skipped for the rest of the process;
 *   a rate-limited key (429) or a server error falls through to the next key.
 * - Returns usageMetadata so every call can be costed (thinking tokens bill as output).
 * - Model content parts are returned verbatim so callers can append them to
 *   history unchanged — Gemini 3 requires thought signatures on function-call
 *   parts to be echoed back.
 */

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  thought?: boolean;
  thoughtSignature?: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface GeminiRequest {
  model?: string;
  system?: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  /** "AUTO" (default) | "ANY" | "NONE" */
  toolMode?: "AUTO" | "ANY" | "NONE";
  temperature?: number;
  maxOutputTokens?: number;
  /** Structured output: JSON Schema the response must follow. */
  responseJsonSchema?: Record<string, unknown>;
  /** Gemini 3 thinking level; "minimal" keeps voice latency low. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  totalTokenCount: number;
}

export interface GeminiResponse {
  model: string;
  parts: GeminiPart[];
  text: string;
  functionCalls: { name: string; args: Record<string, unknown>; id?: string }[];
  usage: GeminiUsage;
  finishReason?: string;
  keyIndex: number;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const deadKeys = new Set<string>();

function keys(): string[] {
  const list = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return list.filter((k) => !deadKeys.has(k));
}

export function geminiConfigured(): boolean {
  return keys().length > 0;
}

function emptyUsage(): GeminiUsage {
  return { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 0 };
}

export async function generate(req: GeminiRequest): Promise<GeminiResponse> {
  const model = req.model ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  const body: Record<string, unknown> = {
    contents: req.contents,
    generationConfig: {
      temperature: req.temperature ?? 0.4,
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      ...(req.responseJsonSchema
        ? { responseMimeType: "application/json", responseJsonSchema: req.responseJsonSchema }
        : {}),
      ...(req.thinkingLevel ? { thinkingConfig: { thinkingLevel: req.thinkingLevel } } : {}),
    },
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.tools?.length) {
    body.tools = [{ functionDeclarations: req.tools }];
    body.toolConfig = { functionCallingConfig: { mode: req.toolMode ?? "AUTO" } };
  }

  const available = keys();
  if (!available.length) throw new GeminiError("No usable Gemini API key (set GEMINI_API_KEYS)", 0);

  let lastError: GeminiError | undefined;
  for (const [i, key] of available.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
          usageMetadata?: Partial<GeminiUsage>;
          modelVersion?: string;
        };
        const cand = json.candidates?.[0];
        const parts = cand?.content?.parts ?? [];
        return {
          model: json.modelVersion ?? model,
          parts,
          text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""),
          functionCalls: parts
            .filter((p) => p.functionCall)
            .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {}, id: p.functionCall!.id })),
          usage: { ...emptyUsage(), ...json.usageMetadata },
          finishReason: cand?.finishReason,
          keyIndex: i,
        };
      }
      const detail = await res.text().catch(() => "");
      lastError = new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 300)}`, res.status);
      if (res.status === 401 || res.status === 403) {
        deadKeys.add(key);
        break; // next key
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0 && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 400));
          continue; // one retry on the same key for server errors
        }
        break; // next key
      }
      throw lastError; // 400 etc. — a bug in the request, don't burn other keys
    }
  }
  throw lastError ?? new GeminiError("All Gemini keys failed", 0);
}

/** Generate and parse a JSON response against a schema. */
export async function generateJson<T>(req: GeminiRequest & { responseJsonSchema: Record<string, unknown> }) {
  const res = await generate(req);
  try {
    return { value: JSON.parse(res.text) as T, response: res };
  } catch {
    throw new GeminiError(`Gemini returned non-JSON output: ${res.text.slice(0, 200)}`, 0);
  }
}
