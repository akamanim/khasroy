"use client";

import { useEffect } from "react";

type SelfTestResponse = {
  ok?: boolean;
  status?: "idle" | "running" | "done" | "failed";
  stage?: string;
  progress?: string;
  retryAfterMs?: number;
};

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(500, Math.min(ms, 70_000))),
  );
}

async function callSelfTest(action: "ensure" | "step") {
  return fetch("/api/site-agent/selftest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ action }),
  });
}

export function SelfTestRunner() {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Give the normal UI/auth bootstrap priority. This job is deliberately silent
      // and never blocks chat interaction.
      await wait(2200);

      let transportFailures = 0;
      while (!cancelled) {
        try {
          const ensured = await callSelfTest("ensure");
          if (ensured.status === 401) {
            // The owner may authenticate after page load. Retry quietly instead of
            // forcing an auth modal just for a background test.
            await wait(30_000);
            continue;
          }
          if (!ensured.ok) {
            await wait(15_000);
            continue;
          }

          let state = (await ensured.json()) as SelfTestResponse;
          if (state.status === "done" || state.status === "failed" || state.status === "idle") return;

          while (!cancelled && state.status === "running") {
            await wait(state.retryAfterMs || 900);
            const stepped = await callSelfTest("step");
            if (stepped.status === 401) {
              await wait(30_000);
              break;
            }
            if (!stepped.ok) {
              transportFailures += 1;
              await wait(Math.min(5000 + transportFailures * 1500, 20_000));
              continue;
            }

            transportFailures = 0;
            state = (await stepped.json()) as SelfTestResponse;
            if (state.status === "done" || state.status === "failed") return;
          }
        } catch {
          transportFailures += 1;
          await wait(Math.min(5000 + transportFailures * 1500, 20_000));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
