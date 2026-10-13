// Notification sound candidates: pure sample math, so the page and the shipped files come from the same code.
const SR = 44100;
const SEMI = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, Bb: 10, B: 11 };
const hz = (n) => { const m = n.match(/^([A-G][#b]?)(\d)$/); return 440 * 2 ** ((SEMI[m[1]] + 12 * (+m[2] + 1) - 69) / 12); };
// voice: attack seconds, partials [ratio, amp, decay tau]
const VOICES = {
  wood: { a: 0.003, p: [[1, 1, 0.2], [3.93, 0.35, 0.05], [9.6, 0.1, 0.02]] },
  glass: { a: 0.002, p: [[1, 1, 0.5], [2, 0.45, 0.32], [3, 0.22, 0.2], [4.16, 0.16, 0.12], [5.43, 0.08, 0.08]] },
  soft: { a: 0.008, p: [[1, 1, 0.11], [2, 0.15, 0.06]] },
  coin: { a: 0.002, p: [[1, 1, 0.28], [3, 0.3, 0.14], [5, 0.12, 0.09]] },
  chip: { a: 0.001, p: [[1, 1, 0.09], [3, 0.33, 0.09], [5, 0.2, 0.09], [7, 0.14, 0.08], [9, 0.11, 0.07]] },
  pluck: { a: 0.001, p: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 1 / n, 0.3 / n ** 0.8]) },
  sine: { a: 0.004, p: [[1, 1, 0.25]] },
  chime: { a: 0.012, p: [[1, 1, 0.3], [2, 0.12, 0.18], [3, 0.04, 0.1]] },
  vibe: { a: 0.006, p: [[1, 1, 0.28], [4, 0.18, 0.12], [10, 0.04, 0.04]] },
  // fm: [modulator ratio, index, index tau, amp tau]
  keys: { a: 0.004, fm: [1, 1.6, 0.12, 0.25] },
  tine: { a: 0.002, fm: [3.5, 2, 0.2, 0.35] },
  zap: { a: 0.002, fm: [1.41, 4, 0.08, 0.16] },
};
// event: [start, voice, note | [f0, f1, dur] for sweep | dur for noise, gain, decay scale]
function render(events) {
  let len = 0;
  for (const e of events) len = Math.max(len, e[0] + 4);
  const out = new Float32Array(Math.ceil(len * SR));
  for (const [t0, v, arg, g = 1, ts = 1] of events) {
    const s0 = Math.round(t0 * SR);
    if (v === 'sweep') {
      const [f0, f1, d] = arg; const n = Math.round(d * SR); let ph = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n; ph += 2 * Math.PI * f0 * (f1 / f0) ** x / SR;
        const e = Math.min(1, i / (0.008 * SR)) * (1 - x) ** 1.5;
        out[s0 + i] += g * e * (Math.sin(ph) + 0.3 * Math.sin(2 * ph));
      }
    } else if (v === 'tone') {
      // flat beep: arg [hz, dur]
      const [f, d] = arg; const n = Math.round(d * SR); const w = 2 * Math.PI * f / SR; const r = 0.006 * SR;
      for (let i = 0; i < n; i++) out[s0 + i] += g * Math.min(1, i / r, (n - i) / r) * (Math.sin(w * i) + 0.25 * Math.sin(3 * w * i) + 0.1 * Math.sin(5 * w * i));
    } else if (v === 'noise') {
      const n = Math.round(arg * SR); let seed = 7, prev = 0;
      for (let i = 0; i < n; i++) {
        seed = (seed * 16807) % 2147483647; const r = seed / 2147483647 * 2 - 1;
        out[s0 + i] += g * 0.6 * (r - prev) * Math.exp(-i / (arg * SR / 4)); prev = r;
      }
    } else {
      const voice = VOICES[v]; const f = hz(arg);
      if (voice.fm) {
        const [r, I, ti, tau0] = voice.fm; const tau = tau0 * ts; const n = Math.round(7 * tau * SR); const w = 2 * Math.PI * f / SR;
        for (let i = 0; i < n; i++) out[s0 + i] += g * Math.min(1, i / (voice.a * SR)) * Math.exp(-i / (tau * SR)) * Math.sin(w * i + I * Math.exp(-i / (ti * SR)) * Math.sin(r * w * i));
      } else for (const [ratio, amp, tau0] of voice.p) {
        const fr = f * ratio; if (fr > SR / 2.2) continue;
        const tau = tau0 * ts; const n = Math.round(7 * tau * SR); const w = 2 * Math.PI * fr / SR;
        for (let i = 0; i < n; i++) out[s0 + i] += g * amp * Math.min(1, i / (voice.a * SR)) * Math.exp(-i / (tau * SR)) * Math.sin(w * i);
      }
    }
  }
  // light room: three feedback taps
  for (let i = 3203; i < out.length; i++) out[i] += 0.2 * out[i - 1613] + 0.13 * out[i - 2377] + 0.09 * out[i - 3203];
  let last = 0, peak = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  for (let i = out.length - 1; i > 0; i--) if (Math.abs(out[i]) > 0.004 * peak) { last = i; break; }
  const end = Math.min(out.length, last + Math.round(0.05 * SR)); const y = out.slice(0, end); const fade = Math.round(0.03 * SR);
  for (let i = 0; i < end; i++) y[i] = y[i] / peak * 0.85 * Math.min(1, (end - i) / fade);
  return y;
}
const rep = (times, fn) => times.flatMap(fn);
const SOUNDS = [
  ['default', 'Ordinary message', {
    wood: ['One warm tap', [[0, 'wood', 'E5']]],
    glass: ['Two-note ping', [[0, 'glass', 'A5', 0.8], [0.1, 'glass', 'E6', 0.6]]],
    soft: ['Double pop', [[0, 'soft', 'C6'], [0.12, 'soft', 'C6', 0.55]]],
  }],
  ['alert', 'Look at this soon', {
    wood: ['Three rising taps', [[0, 'wood', 'G5'], [0.11, 'wood', 'B5'], [0.22, 'wood', 'D6']]],
    glass: ['Bright two-bell', [[0, 'glass', 'E6'], [0.15, 'glass', 'A6']]],
    soft: ['Pair, played twice', rep([0, 0.34], (t) => [[t, 'soft', 'A5'], [t + 0.09, 'soft', 'D6']])],
  }],
  ['urgent', 'Prod broken, money at risk', {
    wood: ['Fast roll, twice', rep([0, 0.7], (t) => [0, 1, 2, 3, 4, 5].map((k) => [t + k * 0.085, 'wood', k % 2 ? 'A5' : 'D6']))],
    glass: ['Three hard strikes', rep([0, 0.3, 0.6], (t) => [[t, 'glass', 'F6', 1, 0.5], [t, 'glass', 'B6', 0.8, 0.5]])],
    soft: ['Rising pips, four times', rep([0, 0.24, 0.48, 0.72], (t) => [[t, 'soft', 'E6'], [t + 0.08, 'soft', 'A6']])],
  }],
  ['cash', 'Order paid', {
    wood: ['Quick run up the chord', ['C6', 'E6', 'G6', 'C7'].map((n, k) => [k * 0.065, 'wood', n])],
    glass: ['Coin: short note, long note', [[0, 'coin', 'B5', 0.8, 0.3], [0.09, 'coin', 'E6', 1, 1.4]]],
    soft: ['Click, then sparkle', [[0, 'noise', 0.05], ...['E6', 'G#6', 'B6', 'E7'].map((n, k) => [0.06 + k * 0.045, 'soft', n, 1, 1.4])]],
  }],
  ['done', 'Job or agent finished', {
    wood: ['Two taps, resolved', [[0, 'wood', 'G5'], [0.16, 'wood', 'C6', 1, 1.5]]],
    glass: ['Strummed major chord', [[0, 'glass', 'E5', 0.7], [0.05, 'glass', 'G#5', 0.7], [0.1, 'glass', 'B5', 0.7], [0.2, 'glass', 'E6']]],
    soft: ['Swoop up and settle', [[0, 'sweep', [400, 800, 0.18], 0.8], [0.2, 'soft', 'C6', 1, 2]]],
  }],
  ['fail', 'Build, deploy or job failed', {
    wood: ['Two falling taps and a thud', [[0, 'wood', 'G4'], [0.16, 'wood', 'Eb4'], [0.32, 'sweep', [180, 90, 0.25], 0.9]]],
    glass: ['Sour low pair', [[0, 'glass', 'A4', 1, 0.8], [0, 'glass', 'Bb4', 0.9, 0.8]]],
    soft: ['Double droop', [[0, 'sweep', [420, 160, 0.22]], [0.28, 'sweep', [420, 160, 0.22]]]],
  }],
  ['ask', 'An agent needs your answer', {
    wood: ['Rising fifth, left open', [[0, 'wood', 'D5'], [0.14, 'wood', 'A5']]],
    glass: ['Bell, then a step up', [[0, 'glass', 'E6'], [0.18, 'glass', 'F#6', 0.7]]],
    soft: ['Upward "hm?"', [[0, 'sweep', [480, 900, 0.2]]]],
  }],
];
// second round of themes: chip (8-bit), pluck (strings), keys (electric piano), space (sweeps and pings)
const MORE = {
  default: {
    chip: ['One blip', [[0, 'chip', 'B5']]],
    pluck: ['One string, with its octave', [[0, 'pluck', 'A4'], [0, 'pluck', 'A5', 0.4]]],
    keys: ['One soft key', [[0, 'keys', 'G5']]],
    space: ['Sonar ping with an echo', [[0, 'sine', 'A5'], [0.26, 'sine', 'A5', 0.3]]],
  },
  alert: {
    chip: ['Three blips climbing', [[0, 'chip', 'E5'], [0.075, 'chip', 'G#5'], [0.15, 'chip', 'B5', 1, 1.6]]],
    pluck: ['Three strings up', [[0, 'pluck', 'E4'], [0.1, 'pluck', 'B4'], [0.2, 'pluck', 'E5']]],
    keys: ['Stacked fourths', [[0, 'keys', 'D5'], [0.11, 'keys', 'G5'], [0.22, 'keys', 'C6']]],
    space: ['Double chirp', rep([0, 0.15], (t) => [[t, 'sweep', [600, 1400, 0.1]]])],
  },
  urgent: {
    chip: ['Two-note siren', rep([0, 1, 2, 3, 4, 5, 6, 7], (k) => [[k * 0.12, 'chip', k % 2 ? 'E6' : 'A5', 1, 1.4]])],
    pluck: ['Hard minor strum, three times', rep([0, 0.3, 0.6], (t) => ['E4', 'B4', 'E5', 'G5'].map((n) => [t, 'pluck', n, 1, 0.5]))],
    keys: ['Clashing chord, pulsed four times', rep([0, 0.2, 0.4, 0.6], (t) => ['E5', 'F5', 'B5'].map((n) => [t, 'keys', n, 1, 0.4]))],
    space: ['Alarm sweep, three times', rep([0, 0.3, 0.6], (t) => [[t, 'sweep', [500, 1100, 0.24]]])],
  },
  cash: {
    chip: ['Arcade coin', [[0, 'chip', 'B5', 1, 0.6], [0.08, 'chip', 'E6', 1, 3.5]]],
    pluck: ['Harp run up', ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'].map((n, k) => [k * 0.05, 'pluck', n])],
    keys: ['Chord up, bell on top', [[0, 'keys', 'C5'], [0.06, 'keys', 'E5'], [0.12, 'keys', 'G5'], [0.2, 'tine', 'C6', 0.7]]],
    space: ['Shimmer of high blips', ['G6', 'E7', 'B6', 'G7', 'E7'].map((n, k) => [k * 0.045, 'sine', n, 1, 0.5])],
  },
  done: {
    chip: ['Level-clear fanfare', [[0, 'chip', 'G5'], [0.09, 'chip', 'C6'], [0.18, 'chip', 'E6'], [0.27, 'chip', 'G6', 1, 3]]],
    pluck: ['Slow major strum', ['C4', 'E4', 'G4', 'C5', 'E5'].map((n, k) => [k * 0.045, 'pluck', n])],
    keys: ['Two chords, coming home', [...['G4', 'B4', 'D5'].map((n) => [0, 'keys', n, 1, 0.5]), ...['C5', 'E5', 'G5'].map((n) => [0.24, 'keys', n])]],
    space: ['Power-up into a ping', [[0, 'sweep', [300, 1200, 0.3], 0.8], [0.3, 'sine', 'E6', 1, 1.6]]],
  },
  fail: {
    chip: ['Four steps down', ['B4', 'Bb4', 'A4', 'G#4'].map((n, k) => [k * 0.12, 'chip', n, 1, k === 3 ? 3 : 1.2])],
    pluck: ['Drop to a wrong note', [[0, 'pluck', 'E4'], [0.2, 'pluck', 'Bb3', 1, 1.2]]],
    keys: ['Minor chord, falling', [[0, 'keys', 'E5'], [0.14, 'keys', 'C5'], [0.28, 'keys', 'A4', 1, 1.3]]],
    space: ['Power-down', [[0, 'sweep', [700, 90, 0.55]]]],
  },
  ask: {
    chip: ['Blip, blip, jump up', [[0, 'chip', 'C6'], [0.11, 'chip', 'C6'], [0.22, 'chip', 'G6', 1, 1.8]]],
    pluck: ['Open chord, left hanging', ['D4', 'G4', 'A4'].map((n, k) => [k * 0.06, 'pluck', n])],
    keys: ['Major seventh, unresolved', [[0, 'keys', 'C5'], [0.1, 'keys', 'E5'], [0.2, 'keys', 'B5']]],
    space: ['Two metallic blips, second higher', [[0, 'zap', 'E5'], [0.13, 'zap', 'B5']]],
  },
};
for (const s of SOUNDS) Object.assign(s[2], MORE[s[0]]);
// third round, aircraft: cabin (passenger chimes), cockpit (flight-deck beeps), terminal (announcement gong)
const AIR = {
  default: {
    cabin: ['Single ding, like the seatbelt sign', [[0, 'chime', 'E5']]],
    cockpit: ['One short beep', [[0, 'tone', [880, 0.12]]]],
    terminal: ['One gong note', [[0, 'vibe', 'G5']]],
  },
  alert: {
    cabin: ['Ding-dong, high then low, like the call button', [[0, 'chime', 'E5'], [0.42, 'chime', 'C5']]],
    cockpit: ['Three even beeps, caution style', rep([0, 0.2, 0.4], (t) => [[t, 'tone', [950, 0.1]]])],
    terminal: ['Three notes up, announcement starting', [[0, 'vibe', 'C5'], [0.25, 'vibe', 'E5'], [0.5, 'vibe', 'G5']]],
  },
  urgent: {
    cabin: ['High-low, three times', rep([0, 0.5, 1], (t) => [[t, 'chime', 'E5', 1, 0.5], [t + 0.22, 'chime', 'C5', 1, 0.5]])],
    cockpit: ['Fast two-tone warble, warning style', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [k * 0.09, 'tone', [k % 2 ? 1000 : 1400, 0.085]])],
    terminal: ['Four notes up, fast, twice', rep([0, 0.65], (t) => ['C5', 'E5', 'G5', 'C6'].map((n, k) => [t + k * 0.11, 'vibe', n, 1, 0.5]))],
  },
  cash: {
    cabin: ['Three quick dings going up', [[0, 'chime', 'C5', 1, 0.7], [0.12, 'chime', 'E5', 1, 0.7], [0.24, 'chime', 'G5']]],
    cockpit: ['One held chord, altitude-alert style', [[0, 'tone', [523, 0.45], 0.6], [0, 'tone', [659, 0.45], 0.6], [0, 'tone', [784, 0.45], 0.6]]],
    terminal: ['Bright run to the top', ['G5', 'C6', 'E6', 'G6'].map((n, k) => [k * 0.09, 'vibe', n])],
  },
  done: {
    cabin: ['Low then high, settled', [[0, 'chime', 'G4'], [0.35, 'chime', 'C5']]],
    cockpit: ['Two-tone confirm, low then high', [[0, 'tone', [660, 0.12]], [0.14, 'tone', [990, 0.2]]]],
    terminal: ['Three notes down, announcement over', [[0, 'vibe', 'G5'], [0.25, 'vibe', 'E5'], [0.5, 'vibe', 'C5']]],
  },
  fail: {
    cabin: ['Two low dongs, falling', [[0, 'chime', 'A4'], [0.4, 'chime', 'F4']]],
    cockpit: ['Low buzzer, twice', rep([0, 0.3], (t) => [[t, 'tone', [280, 0.22]]])],
    terminal: ['Three notes down, minor', [[0, 'vibe', 'G5'], [0.22, 'vibe', 'Eb5'], [0.44, 'vibe', 'C5']]],
  },
  ask: {
    cabin: ['Same ding twice', [[0, 'chime', 'E5'], [0.3, 'chime', 'E5']]],
    cockpit: ['Three pips, middle one lower', [[0, 'tone', [900, 0.1]], [0.13, 'tone', [700, 0.1]], [0.26, 'tone', [900, 0.16]]]],
    terminal: ['Two notes up, third one missing', [[0, 'vibe', 'C5'], [0.25, 'vibe', 'G5']]],
  },
};
for (const s of SOUNDS) Object.assign(s[2], AIR[s[0]]);
if (typeof module !== 'undefined') module.exports = { SOUNDS, render, SR };
