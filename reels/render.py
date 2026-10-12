#!/usr/bin/env python3
"""Render a reel plan (JSON) to a 1080x1920 MP4.

    python3 reels/render.py plan.json out.mp4 [--fps 30] [--frames-at 0.5,2,4 --frames-dir dir]

Opens public/reels-runtime/index.html in headless Chromium (Playwright), seeks every frame and pipes the
screenshots into ffmpeg. Same plan → same video. --frames-at saves stills instead, for quick checks.
"""
import argparse
import os
import json
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
# The runtime lives in public/ so the owner console can preview plans live with the same code.
PAGE = (ROOT.parent / "public" / "reels-runtime" / "index.html").as_uri()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--frames-at", default="")
    ap.add_argument("--frames-dir", default=".")
    ap.add_argument("--scale", type=float, default=1.0, help="0.5 renders a quick 540x960 draft")
    args = ap.parse_args()
    plan = json.loads(pathlib.Path(args.plan).read_text(encoding="utf-8"))

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--allow-file-access-from-files", "--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=args.scale)
        page.goto(PAGE)
        # Load every declared font face up front: text is measured to fit the frame.
        page.evaluate("async () => { await Promise.all([...document.fonts].map((f) => f.load())); await document.fonts.ready; }")
        duration = page.evaluate("(plan) => reel.load(plan)", plan)
        # Wait for fonts and images used by the scenes.
        page.evaluate("""async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
        }""")
        stage = page.locator("#stage")

        if args.frames_at:
            out_dir = pathlib.Path(args.frames_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
            for t in [float(x) for x in args.frames_at.split(",") if x]:
                page.evaluate("(t) => reel.seek(t)", t)
                stage.screenshot(path=str(out_dir / f"frame_{t:06.2f}.png"))
            print(f"duration {duration:.2f}s")
            browser.close()
            return 0

        cues = page.evaluate("reel.cues()")
        cuts = page.evaluate("reel.scenes.map((s) => ({ tool: s.tool, cut: s.cut }))")
        frames = int(round(duration * args.fps))
        size = f"{int(1080 * args.scale)}x{int(1920 * args.scale)}"
        silent = args.out + ".video.mp4"
        ff = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(args.fps), "-c:v", "mjpeg", "-i", "-",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", "-movflags", "+faststart",
             "-s", size, silent],
            stdin=subprocess.PIPE,
        )
        for i in range(frames):
            page.evaluate("(t) => reel.seek(t)", i / args.fps)
            # JPEG at high quality is several times faster to capture than PNG and looks the same after H.264.
            ff.stdin.write(stage.screenshot(type="jpeg", quality=95))
        ff.stdin.close()
        code = ff.wait()
        browser.close()
        if code:
            return code

        # Soundtrack: music in the plan's style plus effects on the runtime's cues.
        if plan.get("music", "on") != "off":
            from audio import soundtrack  # noqa: E402  (sibling module)
            outro = next((c["cut"] for c in cuts if c["tool"] == "outro"), None)
            wav = soundtrack(duration, cues, style=plan.get("style", "pulse"), bpm=plan.get("bpm"),
                             seed=int(plan.get("seed", 1)), outro_at=outro, path=args.out + ".wav")
            code = subprocess.call(["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac",
                                    "-b:a", "192k", "-ar", "48000", "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-shortest", "-movflags", "+faststart", args.out])
            pathlib.Path(wav).unlink(missing_ok=True)
            pathlib.Path(silent).unlink(missing_ok=True)
        else:
            pathlib.Path(silent).rename(args.out)
        print(f"{args.out}: {frames} frames, {duration:.2f}s, {len(cues)} sound cues")
        return code


if __name__ == "__main__":
    sys.exit(main())
