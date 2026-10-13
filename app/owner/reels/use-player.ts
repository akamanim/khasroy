"use client";

// The studio player: drives the reel runtime inside an iframe and plays the soundtrack from the
// same clock. The soundtrack is generated in the browser (lib/reels/preview-audio.ts) or, for the
// owner's own track, decoded from the file; the final MP4 gets the same sound from reels/audio.py.

import { useCallback, useEffect, useRef, useState } from "react";
import { PREVIEW_RATE, soundtrack, type Cue } from "@/lib/reels/preview-audio";

export type PlayerPlan = {
  scenes: { tool: string; duration: number }[];
  style?: string;
  bpm?: number;
  seed?: number;
  music?: "on" | "off" | "track";
  track?: string;
  trackOffset?: number;
};

type ReelWindow = Window & {
  reel?: { load(plan: unknown): number; seek(t: number): void; cues(): Cue[]; scenes: { tool: string; cut: number }[] };
};

// Decoded tracks, mono at the preview rate, by URL — decoding a song takes a moment.
const trackCache = new Map<string, Promise<Float32Array>>();
export function decodeTrack(url: string): Promise<Float32Array> {
  let job = trackCache.get(url);
  if (!job) {
    job = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`трек не загрузился (${r.status})`);
        return r.arrayBuffer();
      })
      .then((data) => new OfflineAudioContext(1, 1, PREVIEW_RATE).decodeAudioData(data))
      .then((buffer) => {
        const out = new Float32Array(buffer.length);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const ch = buffer.getChannelData(c);
          for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
        }
        return out;
      });
    job.catch(() => trackCache.delete(url));
    trackCache.set(url, job);
  }
  return job;
}

export function usePlayer(plan: PlayerPlan | null, planKey: string) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameLoads, setFrameLoads] = useState(0);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [wave, setWave] = useState<number[]>([]);
  const [outroAt, setOutroAt] = useState<number | undefined>();
  const [soundState, setSoundState] = useState<"idle" | "making" | "ready" | "error">("idle");
  const [soundError, setSoundError] = useState("");
  const [loop, setLoop] = useState<[number, number] | null>(null);

  const audio = useRef<{ ctx?: AudioContext; buffer?: AudioBuffer; source?: AudioBufferSourceNode; samples?: Float32Array; gain?: GainNode }>({});
  // Start a little into the reel: at 0 s the first words are still on their way in.
  const clock = useRef({ startedAt: 0, offset: 0.8 });
  const live = useRef({ playing: false, muted: false, time: 0, duration: 0, loop: null as [number, number] | null });
  live.current = { playing, muted, time, duration, loop };

  const win = () => frame.current?.contentWindow as ReelWindow | null | undefined;

  const stopSound = useCallback(() => {
    try {
      audio.current.source?.stop();
    } catch {
      /* already stopped */
    }
    audio.current.source = undefined;
  }, []);

  /** Must run inside a click for Safari: creates and unlocks the audio context. */
  const unlock = useCallback(() => {
    const a = audio.current;
    if (!a.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      a.ctx = new Ctx();
      a.gain = a.ctx.createGain();
      a.gain.connect(a.ctx.destination);
    }
    void a.ctx.resume();
  }, []);

  const startSound = useCallback((offset: number) => {
    stopSound();
    const a = audio.current;
    if (live.current.muted || !a.samples || !a.ctx || !a.gain) return;
    if (!a.buffer) {
      a.buffer = a.ctx.createBuffer(1, a.samples.length, PREVIEW_RATE);
      a.buffer.getChannelData(0).set(a.samples);
    }
    const src = a.ctx.createBufferSource();
    src.buffer = a.buffer;
    src.connect(a.gain);
    src.start(0, Math.max(0, Math.min(offset, a.buffer.duration - 0.01)));
    a.source = src;
  }, [stopSound]);

  // Load the plan into the runtime and build its soundtrack.
  useEffect(() => {
    const w = win();
    if (!frameLoads || !w?.reel || !plan) return;
    let cancelled = false;
    Promise.all([...w.document.fonts].map((f) => f.load().catch(() => undefined))).then(async () => {
      if (cancelled || !w.reel) return;
      const d = w.reel.load(plan);
      setDuration(d);
      const t = Math.min(clock.current.offset, Math.max(0, d - 0.01));
      clock.current = { startedAt: performance.now(), offset: t };
      w.reel.seek(t);
      setTime(t);
      const cues = w.reel.cues();
      const outro = w.reel.scenes.find((s) => s.tool === "outro")?.cut;
      setOutroAt(outro);
      setSoundState("making");
      setSoundError("");
      await new Promise((r) => setTimeout(r, 20));
      let track: Float32Array | undefined;
      if (plan.music === "track" && plan.track) {
        try {
          const full = await decodeTrack(plan.track);
          track = full.subarray(Math.floor((plan.trackOffset ?? 0) * PREVIEW_RATE));
        } catch (error) {
          setSoundError(error instanceof Error ? error.message : "трек не загрузился");
        }
      }
      if (cancelled) return;
      const { samples } = soundtrack(d, cues, {
        style: plan.style,
        bpm: plan.bpm,
        seed: plan.seed,
        outroAt: outro,
        music: plan.music !== "off",
        track,
      });
      audio.current.samples = samples;
      audio.current.buffer = undefined;
      const bars = 96;
      const step = Math.max(1, Math.floor(samples.length / bars));
      setWave(Array.from({ length: bars }, (_, i) => {
        let peak = 0;
        for (let k = i * step; k < (i + 1) * step && k < samples.length; k += 8) peak = Math.max(peak, Math.abs(samples[k]));
        return peak;
      }));
      setSoundState("ready");
      // Pressed play while the sound was being made: join in at the current moment.
      if (live.current.playing) startSound(clock.current.offset + (performance.now() - clock.current.startedAt) / 1000);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameLoads, planKey]);

  // One clock for picture and sound.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      let t = clock.current.offset + (performance.now() - clock.current.startedAt) / 1000;
      const range = live.current.loop;
      const end = range ? range[1] : live.current.duration;
      if (end && t >= end) {
        t = range ? range[0] : 0;
        clock.current = { startedAt: performance.now(), offset: t };
        startSound(t);
      }
      win()?.reel?.seek(t);
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const play = useCallback(() => {
    unlock();
    const { time: t, duration: d, loop: range } = live.current;
    let from = t >= d - 0.05 ? 0 : t;
    if (range && (from < range[0] || from >= range[1])) from = range[0];
    clock.current = { startedAt: performance.now(), offset: from };
    setPlaying(true);
    live.current.playing = true;
    startSound(from);
  }, [startSound, unlock]);

  const pause = useCallback(() => {
    clock.current.offset = live.current.time;
    stopSound();
    setPlaying(false);
  }, [stopSound]);

  const seek = useCallback((t: number) => {
    const d = live.current.duration;
    const v = Math.max(0, Math.min(t, Math.max(0, d - 0.01)));
    clock.current = { startedAt: performance.now(), offset: v };
    setTime(v);
    win()?.reel?.seek(v);
    if (live.current.playing) startSound(v);
  }, [startSound]);

  useEffect(() => {
    live.current.muted = muted;
    if (muted) stopSound();
    else if (live.current.playing) startSound(live.current.time);
  }, [muted, startSound, stopSound]);

  useEffect(() => () => stopSound(), [stopSound]);

  return {
    frame,
    onFrameLoad: () => setFrameLoads((n) => n + 1),
    duration,
    time,
    playing,
    play,
    pause,
    toggle: () => (live.current.playing ? pause() : play()),
    seek,
    muted,
    setMuted,
    wave,
    outroAt,
    soundState,
    soundError,
    loop,
    setLoop,
  };
}
