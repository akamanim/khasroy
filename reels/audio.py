#!/usr/bin/env python3
"""Soundtrack for a reel, made in code: music in one of a few styles plus sound effects on the
cues the runtime reports (transitions, hits, pops, clicks). No samples, no licences.

    from audio import soundtrack
    soundtrack(duration, cues, style="pulse", bpm=120, seed=1, path="music.wav")
"""
from __future__ import annotations

import math
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100


# ---------- small DSP helpers ----------
def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def env(n: int, attack: float, decay: float) -> np.ndarray:
    """Attack then exponential decay, n samples long."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))


def lowpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, min(hz, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def highpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bandpass(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return sosfilt(butter(2, [lo, min(hi, SR / 2 - 100)], "band", fs=SR, output="sos"), x)


def add(buf: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(at * SR)
    if i >= len(buf) or i + len(sound) <= 0:
        return
    j = min(len(buf), i + len(sound))
    buf[max(i, 0):j] += gain * sound[max(0, -i):j - i]


def note_hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------- instruments ----------
def kick(rng, punch=1.0) -> np.ndarray:
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.16)
    click = rng.standard_normal(n) * env(n, 0.0005, 0.004) * 0.3
    return np.tanh((body + click) * 1.6 * punch)


def snare(rng, bright=1.0) -> np.ndarray:
    n = int(0.3 * SR)
    noise = bandpass(rng.standard_normal(n), 1200, 9000 * bright) * env(n, 0.001, 0.07)
    tone = np.sin(2 * np.pi * 190 * np.arange(n) / SR) * env(n, 0.001, 0.05)
    return 0.8 * noise + 0.5 * tone


def clap(rng) -> np.ndarray:
    n = int(0.25 * SR)
    out = np.zeros(n)
    for k, d in enumerate([0, 0.011, 0.022]):
        burst = bandpass(rng.standard_normal(n), 900, 6000) * env(n, 0.0005, 0.012 if k < 2 else 0.09)
        add(out, burst[: n - int(d * SR)], d)
    return out * 0.8


def hat(rng, open_=False) -> np.ndarray:
    n = int((0.25 if open_ else 0.06) * SR)
    return highpass(rng.standard_normal(n), 7000) * env(n, 0.0005, 0.08 if open_ else 0.018) * 0.5


def bass_note(hz: float, seconds: float, glide_from: float | None = None) -> np.ndarray:
    t = t_axis(seconds)
    f = np.full_like(t, hz) if glide_from is None else hz + (glide_from - hz) * np.exp(-t * 18)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) + 0.25 * np.sin(2 * phase) + 0.1 * np.sign(np.sin(phase))
    e = env(len(t), 0.005, seconds * 0.9)
    return lowpass(np.tanh(x * 1.3) * e, 900)


def pad_chord(notes: list[float], seconds: float, warm=True) -> np.ndarray:
    t = t_axis(seconds)
    x = np.zeros_like(t)
    for m in notes:
        for detune in (-0.08, 0.0, 0.08):
            f = note_hz(m + detune)
            x += np.sin(2 * np.pi * f * t + detune * 7) + 0.3 * np.sin(4 * np.pi * f * t)
    attack = min(0.35, seconds * 0.3)
    e = np.clip(t / attack, 0, 1) * np.clip((seconds - t) / 0.25, 0, 1)
    x = x * e / (len(notes) * 3)
    return lowpass(x, 2200 if warm else 4200)


def keys_chord(notes: list[float], seconds: float) -> np.ndarray:
    """Soft electric-piano-like chord (sine + bell partial + tremolo)."""
    t = t_axis(seconds)
    x = np.zeros_like(t)
    for m in notes:
        f = note_hz(m)
        x += (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 6)) * np.exp(-t * 1.4)
    trem = 1 + 0.15 * np.sin(2 * np.pi * 4.5 * t)
    return x * trem / len(notes)


# ---------- styles ----------
STYLES = {
    # name: bpm, chord roots (A minor family), feel
    "pulse": {"bpm": 120, "prog": [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], "pad": "pad"},
    "bounce": {"bpm": 140, "prog": [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]], "pad": "pad"},
    "chill": {"bpm": 92, "prog": [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [52, 55, 59, 62]], "pad": "keys"},
}


def music(duration: float, style: str, bpm: float, seed: int, outro_at: float | None) -> np.ndarray:
    rng = np.random.default_rng(seed)
    spec = STYLES.get(style, STYLES["pulse"])
    beat = 60.0 / bpm
    n = int((duration + 1.5) * SR)
    drums = np.zeros(n)
    bass = np.zeros(n)
    harm = np.zeros(n)
    duck = np.ones(n)
    k = kick(rng, 1.15 if style == "bounce" else 1.0)
    sn = snare(rng) if style != "pulse" else clap(rng)
    hh, oh = hat(rng), hat(rng, True)
    total_beats = int(math.ceil(duration / beat)) + 1
    bar_beats = 4
    end = outro_at if outro_at else duration
    for b in range(total_beats):
        t0 = b * beat
        if t0 >= duration:
            break
        in_bar = b % bar_beats
        intro = b < 2  # first two beats: no kick, just the hook
        tail = t0 >= end  # outro: drums drop out, a final hit at the cut
        if style == "pulse":
            if not intro and not tail:
                add(drums, k, t0, 0.9)
                add(duck, -0.55 * env(int(0.25 * SR), 0.002, 0.09), t0)
                add(drums, hh, t0 + beat / 2, 0.55)
                if in_bar in (1, 3):
                    add(drums, sn, t0, 0.55)
        elif style == "bounce":
            if not intro and not tail:
                if in_bar in (0, 2) or (in_bar == 3 and rng.random() < 0.5):
                    add(drums, k, t0 + (0.5 * beat if in_bar == 3 else 0), 0.95)
                    add(duck, -0.6 * env(int(0.3 * SR), 0.002, 0.12), t0)
                if in_bar == 2:
                    add(drums, sn, t0, 0.7)
                for s16 in range(4 if rng.random() < 0.25 else 2):
                    add(drums, hh, t0 + s16 * beat / (4 if s16 > 1 else 2), 0.45)
        else:  # chill
            if not intro and not tail:
                if in_bar in (0, 2):
                    add(drums, k * 0.8, t0 + (0.06 if in_bar == 2 else 0), 0.7)
                    add(duck, -0.3 * env(int(0.3 * SR), 0.002, 0.15), t0)
                if in_bar in (1, 3):
                    add(drums, sn * 0.7, t0, 0.45)
                add(drums, hh, t0 + beat * 0.58, 0.3)
        # Harmony and bass follow a chord per bar.
        if in_bar == 0:
            chord = spec["prog"][(b // bar_beats) % len(spec["prog"])]
            bar_len = min(beat * bar_beats, duration + 1 - t0)
            if spec["pad"] == "keys":
                add(harm, keys_chord(chord, bar_len), t0, 0.5)
            else:
                add(harm, pad_chord(chord, bar_len), t0, 0.45 if not tail else 0.6)
            root = note_hz(chord[0] - 24)
            if not tail:
                if style == "bounce":
                    add(bass, bass_note(root, beat * 1.5, glide_from=root * 1.5), t0, 0.9)
                    add(bass, bass_note(root, beat * 1.0), t0 + beat * 2.5, 0.7)
                else:
                    for q in range(bar_beats):
                        add(bass, bass_note(root, beat * 0.45), t0 + q * beat + (beat / 2 if style == "pulse" else 0), 0.55)
    # Fade the hook in: the first beats are filtered, as if behind a door.
    intro_len = int(2 * beat * SR)
    harm[:intro_len] = lowpass(harm[:intro_len], 700)
    duck = np.clip(duck, 0.25, 1)
    mix = drums + (bass + harm) * duck
    return mix[: int(duration * SR)]


# ---------- sound effects ----------
def sfx(name: str, length: float, rng) -> np.ndarray:
    if name == "whoosh":
        n = int(max(0.25, length) * SR)
        t = np.arange(n) / n
        noise = rng.standard_normal(n)
        out = np.zeros(n)
        # A band of noise sweeping up then down, shaped like a pass-by.
        for i, center in enumerate(np.linspace(600, 5000, 8)):
            seg = bandpass(noise, center * 0.7, center * 1.3)
            w = np.exp(-((t - (0.25 + i * 0.07)) ** 2) / 0.02)
            out += seg * w
        return out * np.sin(np.pi * t) ** 1.5 * 0.5
    if name == "impact":
        n = int(1.2 * SR)
        t = np.arange(n) / SR
        boom = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 14)) / SR) * env(n, 0.002, 0.35)
        crack = highpass(rng.standard_normal(n), 2000) * env(n, 0.0005, 0.05) * 0.6
        tail = lowpass(rng.standard_normal(n), 900) * env(n, 0.01, 0.4) * 0.25
        return np.tanh((boom + crack + tail) * 1.4)
    if name == "glitch":
        n = int(max(0.2, length) * SR)
        out = np.zeros(n)
        pos = 0
        while pos < n:
            seg = int(rng.uniform(0.012, 0.05) * SR)
            f = rng.choice([180, 360, 720, 1440, 2880])
            tt = np.arange(min(seg, n - pos)) / SR
            out[pos:pos + len(tt)] = np.sign(np.sin(2 * np.pi * f * tt)) * rng.uniform(0.2, 0.6) * (rng.random() < 0.7)
            pos += seg
        return lowpass(out, 6000) * 0.5
    if name == "pop":
        n = int(0.14 * SR)
        t = np.arange(n) / SR
        f = 520 + 700 * (1 - np.exp(-t * 60))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.035) * 0.6
    if name == "click":
        n = int(0.08 * SR)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 2200 * t) * env(n, 0.0003, 0.008) + highpass(rng.standard_normal(n), 3000) * env(n, 0.0003, 0.004)) * 0.7
    if name == "tick":
        n = int(0.05 * SR)
        t = np.arange(n) / SR
        return np.sin(2 * np.pi * 3200 * t) * env(n, 0.0002, 0.006) * 0.35
    if name == "notify":
        n = int(0.9 * SR)
        t = np.arange(n) / SR
        a = np.sin(2 * np.pi * note_hz(88) * t) * env(n, 0.002, 0.25)
        b = np.zeros(n)
        add(b, np.sin(2 * np.pi * note_hz(95) * t[: n - int(0.11 * SR)]) * env(n - int(0.11 * SR), 0.002, 0.3), 0.11)
        return (a + b) * 0.35
    if name == "riser":
        n = int(max(0.4, length) * SR)
        t = np.arange(n) / n
        noise = highpass(rng.standard_normal(n), 1500) * t ** 2 * 0.35
        tone = np.sin(2 * np.pi * np.cumsum(300 + 1500 * t ** 2) / SR) * t ** 2 * 0.12
        return noise + tone
    if name == "voice":
        # Muffled syllables: the sound of a voice message playing, without words.
        n = int(max(0.5, length) * SR)
        out = np.zeros(n)
        pos = 0
        while pos < n:
            syl = int(rng.uniform(0.07, 0.16) * SR)
            gap = int(rng.uniform(0.02, 0.08) * SR)
            tt = np.arange(min(syl, n - pos)) / SR
            f0 = rng.uniform(150, 230)
            s = sum(np.sin(2 * np.pi * f0 * h * tt) / h for h in range(1, 6))
            s *= np.sin(np.pi * tt / max(tt[-1], 1e-3)) if len(tt) > 1 else 1
            out[pos:pos + len(tt)] = s
            pos += syl + gap
        return bandpass(out, 300, 2400) * 0.25
    return np.zeros(1)


def soundtrack(duration: float, cues: list[dict], style: str = "pulse", bpm: float | None = None, seed: int = 1,
               outro_at: float | None = None, path: str = "music.wav") -> str:
    rng = np.random.default_rng(seed + 99)
    bpm = bpm or STYLES.get(style, STYLES["pulse"])["bpm"]
    m = music(duration, style, bpm, seed, outro_at)
    fx = np.zeros_like(m)
    gains = {"whoosh": 0.55, "impact": 0.9, "glitch": 0.45, "pop": 0.5, "click": 0.6, "tick": 0.4, "notify": 0.6, "riser": 0.5, "voice": 0.5}
    for c in cues:
        name = c.get("sfx", "")
        add(fx, sfx(name, float(c.get("len", 0.5)), rng), float(c["t"]), gains.get(name, 0.5))
    if outro_at:
        add(fx, sfx("impact", 1, rng), outro_at, 0.8)
    mix = 0.75 * m + fx
    # Gentle fade in/out and a soft limiter.
    fade = int(0.05 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)
    mix[-int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))
    mix = np.tanh(mix * 1.2) / np.tanh(1.2)
    peak = np.max(np.abs(mix)) or 1
    mix = mix / peak * 0.89
    # A touch of width: the right channel slightly delayed.
    right = np.concatenate([np.zeros(int(0.008 * SR)), mix])[: len(mix)]
    stereo = np.stack([mix, 0.85 * mix + 0.15 * right], axis=1)
    data = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    return path
