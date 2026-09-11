import { Sandbox } from "@vercel/sandbox";

export type SandboxLanguage = "python" | "javascript";

export type SandboxExecution = {
  ok: boolean;
  language: SandboxLanguage;
  runtime: "python3.13" | "node24";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const MAX_CODE_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 8_000;
const SANDBOX_TIMEOUT_MS = 35_000;

function clip(value: string, limit = MAX_OUTPUT_CHARS) {
  const clean = value.replace(/\u0000/gu, "").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}\n…[truncated]` : clean;
}

export async function runCodeSandbox(args: {
  language: SandboxLanguage;
  code: string;
}): Promise<SandboxExecution> {
  const code = args.code.trim();
  if (!code) throw new Error("sandbox code is empty");
  if (code.length > MAX_CODE_CHARS) throw new Error("sandbox code is too large");

  const runtime = args.language === "python" ? "python3.13" : "node24";
  const startedAt = Date.now();
  const sandbox = await Sandbox.create({
    runtime,
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: false,
    networkPolicy: "deny-all",
    resources: { vcpus: 1 },
  });

  try {
    const command = args.language === "python" ? "python3" : "node";
    const result = await sandbox.runCommand(command, ["-c", code]);
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);

    return {
      ok: result.exitCode === 0,
      language: args.language,
      runtime,
      exitCode: result.exitCode,
      stdout: clip(stdout),
      stderr: clip(stderr),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await sandbox.stop().catch((error) => {
      console.error("Khasroy Vercel Sandbox stop failed", error);
    });
  }
}
