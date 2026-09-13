import { NextResponse } from "next/server";
import { resolveSecret } from "@/lib/server-integrations";
import { testPersistentGateway } from "@/lib/ai/persistent-provider-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const PROBE = "khasroy-vision-probe-9f83c2d7";
const TARGET = "https://s.wordpress.com/mshots/v1/https%3A%2F%2Fprombaza.vercel.app%2F?w=390&h=844";

function category(error: unknown) {
  if (!(error instanceof Error)) return "unknown";
  if (/timeout|abort/iu.test(`${error.name} ${error.message}`)) return "timeout";
  if (/fetch/iu.test(error.message)) return "fetch_error";
  return error.name || "error";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("probe") !== PROBE) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() || "";
  const envKey = process.env.GEMINI_API_KEY?.trim() || "";
  let vaultKey = "";
  if (!envKey && ownerKey) {
    vaultKey = await resolveSecret(ownerKey, "gemini", []).catch(() => "");
  }
  const key = envKey || vaultKey;

  const result: Record<string, unknown> = {
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
    geminiConfigured: Boolean(key),
    credentialSource: envKey ? "env" : vaultKey ? "vault" : "missing",
    model:
      process.env.KHASROY_GEMINI_VISION_MODEL?.trim() ||
      process.env.KHASROY_GEMINI_MODEL?.trim() ||
      "gemini-3.5-flash",
  };

  let imageBytes: Uint8Array | null = null;
  let imageMime = "";
  try {
    const image = await fetch(TARGET, {
      cache: "no-store",
      signal: AbortSignal.timeout(18_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Khasroy/1.0",
        Accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,*/*;q=0.8",
      },
    });
    imageMime = (image.headers.get("content-type") || "").split(";")[0].trim();
    result.imageStatus = image.status;
    result.imageMime = imageMime || null;
    if (image.ok) {
      imageBytes = new Uint8Array(await image.arrayBuffer());
      result.imageBytes = imageBytes.byteLength;
      result.imageUsable =
        imageBytes.byteLength > 0 &&
        imageBytes.byteLength <= 6 * 1024 * 1024 &&
        /^image\/(?:png|jpeg|jpg|webp)$/iu.test(imageMime);
    } else {
      await image.body?.cancel().catch(() => undefined);
      result.imageUsable = false;
    }
  } catch (error) {
    result.imageUsable = false;
    result.imageError = category(error);
  }

  if (key) {
    try {
      const model = String(result.model);
      const parts: Array<Record<string, unknown>> = [
        {
          text: 'Inspect the screenshot if supplied. Return JSON exactly like {"ok":true,"visible":true}. Do not copy this schema blindly; visible=false only if no usable screenshot is supplied.',
        },
      ];
      if (imageBytes && result.imageUsable === true) {
        parts.push({
          inlineData: {
            mimeType: imageMime === "image/jpg" ? "image/jpeg" : imageMime,
            data: Buffer.from(imageBytes).toString("base64"),
          },
        });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(24_000),
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: "You are a minimal Khasroy runtime probe. Return strict JSON only." }],
            },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: 80,
              temperature: 0,
            },
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            error?: { code?: number; status?: string };
          }
        | null;
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      result.geminiStatus = response.status;
      result.geminiOk = response.ok;
      result.geminiTextPresent = Boolean(text);
      result.geminiJsonValid = false;
      if (text) {
        try {
          JSON.parse(text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
          result.geminiJsonValid = true;
        } catch {
          result.geminiJsonValid = false;
        }
      }
      if (!response.ok) {
        result.geminiErrorCode = payload?.error?.code || response.status;
        result.geminiErrorStatus = payload?.error?.status || "http_error";
      }
    } catch (error) {
      result.geminiOk = false;
      result.geminiError = category(error);
    }
  }

  const gateway = await testPersistentGateway().catch(() => ({
    configured: false,
    ok: false,
    status: 503,
    model: null,
    latencyMs: 0,
  }));
  result.gatewayConfigured = gateway.configured;
  result.gatewayOk = gateway.ok;
  result.gatewayStatus = gateway.status;
  result.gatewayModel = gateway.model;
  result.gatewayLatencyMs = gateway.latencyMs;

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
