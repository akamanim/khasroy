"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube API failed to load"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type MusicControl = { start: () => void };

/**
 * Background music from a YouTube video. The player itself is not shown; guests
 * get a single sound toggle. Browsers only allow sound after the guest's first
 * tap, so `start` is called from the invitation's "open" button and from the
 * first interaction anywhere on the page.
 */
export function BackgroundMusic({
  videoId,
  start = 0,
  onControl,
  labels,
}: {
  videoId: string;
  start?: number;
  onControl?: (control: MusicControl) => void;
  labels: { on: string; off: string };
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const wanted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  const play = useCallback(() => {
    wanted.current = true;
    if (!ready.current || !player.current) return;
    player.current.unMute();
    player.current.setVolume(70);
    player.current.playVideo();
  }, []);

  useEffect(() => {
    onControl?.({ start: play });
  }, [onControl, play]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const mount = document.createElement("div");
    el.appendChild(mount);
    loadApi()
      .then((YT) => {
        if (disposed) return;
        player.current = new YT.Player(mount, {
          videoId,
          width: 200,
          height: 200,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            loop: 1,
            playlist: videoId,
            playsinline: 1,
            rel: 0,
            start,
          },
          events: {
            onReady: () => {
              ready.current = true;
              // Try right away: works when the browser already trusts the site.
              player.current?.setVolume(70);
              player.current?.playVideo();
              if (wanted.current) play();
            },
            onStateChange: (e) => setPlaying(e.data === PLAYING),
            onError: () => setFailed(true),
          },
        });
      })
      .catch(() => setFailed(true));

    // The first interaction anywhere unlocks sound.
    const unlock = () => {
      if (!muted) play();
    };
    const events = ["pointerdown", "keydown", "touchend"] as const;
    events.forEach((name) => window.addEventListener(name, unlock, { once: true, passive: true }));
    return () => {
      disposed = true;
      events.forEach((name) => window.removeEventListener(name, unlock));
      player.current?.destroy();
      player.current = null;
      ready.current = false;
      mount.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, start]);

  function toggle() {
    const p = player.current;
    if (!p) return;
    if (!playing) {
      setMuted(false);
      play();
      return;
    }
    if (muted) {
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  }

  const audible = playing && !muted;
  return (
    <>
      <div
        ref={host}
        aria-hidden="true"
        style={{
          position: "fixed",
          right: 0,
          bottom: 0,
          width: 200,
          height: 200,
          opacity: 0.001,
          pointerEvents: "none",
          zIndex: -1,
          overflow: "hidden",
        }}
      />
      {failed ? null : (
        <button
          type="button"
          onClick={toggle}
          aria-label={audible ? labels.off : labels.on}
          aria-pressed={audible}
          title={audible ? labels.off : labels.on}
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 50,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,.35)",
            background: "rgba(20,20,28,.55)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 6px 20px rgba(0,0,0,.25)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
            {audible ? (
              <>
                <path d="M16.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 6a8.5 8.5 0 0 1 0 12" />
              </>
            ) : (
              <path d="M17 9l5 6M22 9l-5 6" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}
