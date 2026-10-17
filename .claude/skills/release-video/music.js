// A synthesized backing track for the trailer: no samples, nothing to license.
// 122 BPM uplifting electronic in A minor (Am–F–C–G), arranged in sections:
// intro, groove, chorus, a breakdown with a riser, a bigger chorus and an outro.
// Kick-driven side-chain pumping on pads and bass, a stereo reverb bus, plucked
// arpeggios with a dotted-eighth echo, supersaw chords and a lead hook. Impacts
// and whooshes land on cue times (title cards), the app's alert chime is mixed in
// where it played, and the music ducks around it.
//   require('./music').write(seconds, file, { hits: [s...], chimes: [s...] })
const fs = require('fs');

const SR = 44100;

function write(seconds, file, { bpm = 122, hits = [], chimes = [], seed = 11 } = {}) {
  const n = Math.ceil(seconds * SR);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const L = new Float32Array(n); // dry mix
  const R = new Float32Array(n);
  const sendL = new Float32Array(n); // reverb send
  const sendR = new Float32Array(n);
  const duck = new Float32Array(n).fill(1); // side-chain gain (kick)
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);

  // ---------------------------------------------------------------- helpers
  const at = (t) => Math.round(t * SR);
  function mix(t, buf, { gain = 1, pan = 0, send = 0, sidechain = 0 } = {}) {
    const i0 = at(t);
    const gl = gain * Math.min(1, 1 - pan);
    const gr = gain * Math.min(1, 1 + pan);
    for (let k = 0; k < buf.length; k++) {
      const i = i0 + k;
      if (i < 0 || i >= n) continue;
      const g = sidechain ? 1 - sidechain * (1 - duck[i]) : 1;
      const v = buf[k] * g;
      L[i] += v * gl;
      R[i] += v * gr;
      if (send) {
        sendL[i] += v * gl * send;
        sendR[i] += v * gr * send;
      }
    }
  }
  const make = (sec, f) => {
    const out = new Float32Array(Math.max(1, Math.round(sec * SR)));
    for (let k = 0; k < out.length; k++) out[k] = f(k / SR, k);
    return out;
  };
  // ADSR-ish envelope
  const env = (t, d, a = 0.005, rel = 0.1) => Math.min(1, t / a) * (t < d ? 1 : Math.max(0, 1 - (t - d) / rel));

  // ---------------------------------------------------------------- instruments
  const KICK = (() => {
    let ph = 0;
    return make(0.42, (t) => {
      ph += (2 * Math.PI * (42 + 130 * Math.exp(-t * 38))) / SR;
      const click = t < 0.004 ? (rnd() * 2 - 1) * 0.35 * (1 - t / 0.004) : 0;
      return Math.tanh(Math.sin(ph) * 1.6) * Math.exp(-t * 7.5) * 0.9 + click;
    });
  })();
  const CLAP = (() => {
    let lp = 0;
    return make(0.35, (t) => {
      const bursts = [0, 0.011, 0.022].reduce((sum, o) => sum + (t >= o ? Math.exp(-(t - o) * 90) : 0), 0) * 0.5 + Math.exp(-t * 14) * 0.6;
      const x = rnd() * 2 - 1;
      lp += 0.55 * (x - lp);
      return (x - lp) * bursts * 0.55;
    });
  })();
  const hat = (open) => {
    let prev = 0;
    return make(open ? 0.22 : 0.05, (t) => {
      const x = rnd() * 2 - 1;
      const hp = x - prev;
      prev = x;
      return hp * 0.13 * Math.exp(-t * (open ? 11 : 80));
    });
  };
  const HAT = hat(false);
  const OPEN = hat(true);

  const cache = new Map();
  // Detuned saws through a low-pass with an envelope on the cutoff.
  function synth(midi, dur, { voices = 1, detune = 0.12, vol = 0.2, a = 0.005, rel = 0.12, cut = 0.2, cutEnv = 0, shape = 'saw' } = {}) {
    const key = [midi, dur, voices, detune, vol, a, rel, cut, cutEnv, shape].join();
    if (cache.has(key)) return cache.get(key);
    const f = hz(midi);
    const phases = Array.from({ length: voices }, () => rnd());
    let lp1 = 0;
    let lp2 = 0;
    const out = make(dur + rel, (t) => {
      let w = 0;
      for (let v = 0; v < voices; v++) {
        const spread = voices > 1 ? (v / (voices - 1) - 0.5) * detune : 0;
        const p = (phases[v] + t * f * 2 ** (spread / 12)) % 1;
        w += shape === 'saw' ? 2 * p - 1 : shape === 'sq' ? (p < 0.5 ? 1 : -1) : shape === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : Math.sin(2 * Math.PI * p);
      }
      w /= Math.sqrt(voices);
      const c = Math.min(0.99, cut + cutEnv * Math.exp(-t * 18));
      lp1 += c * (w - lp1);
      lp2 += c * (lp1 - lp2);
      return lp2 * env(t, dur, a, rel) * vol;
    });
    cache.set(key, out);
    return out;
  }

  // ---------------------------------------------------------------- arrangement
  // Am – F – C – G, with voicings around middle C.
  const PROG = [
    { root: 45, chord: [57, 60, 64, 69] },
    { root: 41, chord: [57, 60, 65, 69] },
    { root: 48, chord: [55, 60, 64, 67] },
    { root: 43, chord: [55, 59, 62, 67] },
  ];
  // Lead hook (scale degrees over two bars, repeated with the progression)
  const HOOK = [
    [0, 76, 0.75],
    [0.75, 74, 0.25],
    [1, 72, 0.5],
    [1.5, 74, 0.5],
    [2, 76, 1],
    [3, 79, 0.5],
    [3.5, 76, 0.5],
    [4, 77, 0.75],
    [4.75, 76, 0.25],
    [5, 74, 0.5],
    [5.5, 72, 0.5],
    [6, 71, 1.5],
  ];

  const bars = Math.ceil(seconds / bar);
  // Section of each bar: shapes the energy to the video's length.
  const section = (b) => {
    if (b < 4) return 'intro';
    if (b >= bars - 2) return 'outro';
    const body = b - 4;
    const cycle = body % 24;
    if (cycle < 8) return 'groove';
    if (cycle < 16) return 'chorus';
    if (cycle < 20) return 'break';
    return 'chorus2';
  };

  // Kick first, so the side-chain envelope exists before anything ducks against it.
  for (let b = 0; b < bars; b++) {
    const sec = section(b);
    if (sec === 'intro' || sec === 'break' || sec === 'outro') continue;
    for (let q = 0; q < 4; q++) {
      const t = b * bar + q * beat;
      mix(t, KICK, { gain: 0.95 });
      const i0 = at(t);
      const len = at(beat * 0.85);
      for (let k = 0; k < len && i0 + k < n; k++) duck[i0 + k] = Math.min(duck[i0 + k], 0.18 + 0.82 * (k / len) ** 0.6);
    }
  }

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const sec = section(b);
    const { root, chord } = PROG[b % 4];
    const full = sec === 'chorus' || sec === 'chorus2';
    const intro = sec === 'intro' || sec === 'outro';

    // Pad: always there, soft in the intro/outro and breakdown.
    for (const m of chord.slice(0, 3)) {
      mix(t0, synth(m, bar * 0.98, { voices: 5, detune: 0.18, vol: full ? 0.05 : 0.045, a: 0.25, rel: 0.6, cut: intro ? 0.05 : 0.09 }), { pan: (m % 3) * 0.25 - 0.25, send: 0.6, sidechain: full || sec === 'groove' ? 0.8 : 0 });
    }

    // Plucked arpeggio, 16ths, with an echo at a dotted eighth.
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let i = 0; i < 16; i++) {
      if (sec === 'outro' && i > 7) break;
      const m = chord[arp[i % 8]] + (full && i >= 8 ? 12 : 0);
      const pluck = synth(m, beat / 4 * 0.5, { shape: 'sq', vol: intro ? 0.035 : 0.045, rel: 0.12, cut: 0.05, cutEnv: 0.55 });
      const t = t0 + (i * beat) / 4;
      const pan = i % 2 ? 0.45 : -0.45;
      mix(t, pluck, { pan, send: 0.35 });
      mix(t + beat * 0.75, pluck, { gain: 0.35, pan: -pan, send: 0.5 });
    }

    if (intro || sec === 'break') {
      // Breakdown: a held bass note and an open hat swell.
      if (sec === 'break') mix(t0, synth(root, bar, { shape: 'sine', vol: 0.12, a: 0.3, rel: 0.4 }), { sidechain: 0 });
    } else {
      // Bass: off-beat eighths with octave jumps.
      for (let e = 0; e < 8; e++) {
        const m = root + (e % 4 === 3 ? 12 : 0);
        mix(t0 + (e * beat) / 2 + (e % 2 ? 0 : beat / 4) * 0, synth(m, (beat / 2) * 0.7, { voices: 2, detune: 0.08, vol: 0.16, rel: 0.03, cut: 0.06, cutEnv: 0.18 }), { sidechain: 0.9 });
      }
      // Hats and claps.
      for (let e = 0; e < 8; e++) mix(t0 + (e * beat) / 2 + beat / 4, e % 4 === 3 ? OPEN : HAT, { gain: 0.8, pan: 0.2, send: 0.05 });
      if (full || b % 2) for (const q of [1, 3]) mix(t0 + q * beat, CLAP, { gain: 0.85, send: 0.25 });
      if (full) for (let x = 0; x < 16; x++) if (x % 4 !== 2) mix(t0 + (x * beat) / 4, HAT, { gain: 0.35, pan: -0.3 });
    }

    // Supersaw stabs and the lead hook in the choruses.
    if (full) {
      for (const q of [0, 1.5, 2.5]) for (const m of chord) mix(t0 + q * beat, synth(m + 12, beat * 0.4, { voices: 7, detune: 0.3, vol: 0.022, rel: 0.25, cut: 0.25, cutEnv: 0.3 }), { pan: ((m % 4) - 1.5) * 0.3, send: 0.45, sidechain: 0.6 });
      if (b % 2 === 0) {
        for (const [beatPos, m, len] of HOOK) {
          const note = synth(m + (sec === 'chorus2' ? 12 : 0), len * beat * 0.9, { voices: 3, detune: 0.1, vol: 0.06, a: 0.01, rel: 0.2, cut: 0.18, cutEnv: 0.25, shape: 'saw' });
          mix(t0 + beatPos * beat, note, { send: 0.5, sidechain: 0.3 });
        }
      }
    }

    // Riser into the next section: a pitched swell, not a noise sweep (which sounds like
    // a brush), with only a little dark air under it.
    const next = section(b + 1);
    if (next !== sec && (next === 'chorus' || next === 'chorus2' || next === 'groove')) {
      const phases = [0, 0.33, 0.66];
      let l1 = 0;
      let l2 = 0;
      let a1 = 0;
      let a2 = 0;
      const f0 = hz(root + 12);
      const riser = make(bar, (t) => {
        const k = t / bar;
        const f = f0 * 2 ** k; // up an octave over the bar
        let w = 0;
        phases.forEach((p, v) => {
          phases[v] = (p + (f * 2 ** ((v - 1) * 0.08 / 12)) / SR) % 1;
          w += 2 * phases[v] - 1;
        });
        const c = 0.015 + 0.09 * k * k;
        l1 += c * (w / 3 - l1);
        l2 += c * (l1 - l2);
        const x = rnd() * 2 - 1;
        a1 += 0.05 * (x - a1);
        a2 += 0.05 * (a1 - a2);
        const fade = Math.min(1, (bar - t) / 0.03);
        return (l2 * 0.11 + a2 * 0.06) * k * k * fade;
      });
      mix(t0, riser, { send: 0.45, pan: 0.15 });
    }
  }

  // ---------------------------------------------------------------- cue impacts and swells
  // Each title card: a chord swells in (like a reversed pad) and lands on a deep boom.
  // Both are tonal: bursts of noise here read as a jarring brush stroke.
  const SWELL = 0.9;
  for (const t of hits) {
    let ph = 0;
    let lp = 0;
    const boom = make(1.6, (x) => {
      ph += (2 * Math.PI * (38 + 60 * Math.exp(-x * 12))) / SR;
      const thump = Math.sin(2 * Math.PI * 110 * x) * Math.exp(-x * 45) * 0.1; // soft attack
      const v = (Math.sin(ph) * Math.exp(-x * 2.8) * 0.4 + thump) * Math.min(1, x / 0.004);
      lp += 0.12 * (v - lp);
      return lp;
    });
    mix(t, boom, { send: 0.5 });
    const { chord } = PROG[Math.floor(t / bar) % 4];
    const voices = [chord[0] - 12, chord[0], chord[2]].map((m) => ({ f: hz(m), p: rnd() }));
    let l1 = 0;
    let l2 = 0;
    const swell = make(SWELL, (x) => {
      const k = x / SWELL;
      let w = 0;
      for (const v of voices) {
        v.p = (v.p + v.f / SR) % 1;
        w += 2 * v.p - 1;
      }
      const c = 0.01 + 0.07 * k * k;
      l1 += c * (w / 3 - l1);
      l2 += c * (l1 - l2);
      return l2 * k ** 2.5 * 0.22 * Math.min(1, (SWELL - x) / 0.025);
    });
    mix(t - SWELL, swell, { send: 0.55 });
  }

  // ---------------------------------------------------------------- reverb (Schroeder, stereo)
  const comb = (input, delay, fb, damp) => {
    const out = new Float32Array(n);
    const buf = new Float32Array(delay);
    let i = 0;
    let lp = 0;
    for (let k = 0; k < n; k++) {
      const y = buf[i];
      lp = y * (1 - damp) + lp * damp;
      buf[i] = input[k] + lp * fb;
      out[k] = y;
      i = (i + 1) % delay;
    }
    return out;
  };
  const allpass = (input, delay, g) => {
    const out = new Float32Array(n);
    const buf = new Float32Array(delay);
    let i = 0;
    for (let k = 0; k < n; k++) {
      const b = buf[i];
      const y = -input[k] + b;
      buf[i] = input[k] + b * g;
      out[k] = y;
      i = (i + 1) % delay;
    }
    return out;
  };
  const verb = (input, offset) => {
    const sum = new Float32Array(n);
    for (const d of [1557, 1617, 1491, 1422]) {
      const c = comb(input, d + offset, 0.84, 0.25);
      for (let k = 0; k < n; k++) sum[k] += c[k] * 0.25;
    }
    return allpass(allpass(sum, 225 + offset, 0.5), 556 + offset, 0.5);
  };
  const wetL = verb(sendL, 0);
  const wetR = verb(sendR, 23);

  // ---------------------------------------------------------------- alert chimes (the app's own sound)
  const chimeL = new Float32Array(n);
  for (const t of chimes) {
    [0, 0.55, 1.1].forEach((o) =>
      [
        [880, 0],
        [659.25, 0.16],
      ].forEach(([f, d]) => {
        const i0 = at(t + o + d);
        for (let k = 0; k < at(0.5) && i0 + k < n; k++) {
          const x = k / SR;
          chimeL[i0 + k] += Math.sin(2 * Math.PI * f * x) * Math.min(1, x / 0.015) * Math.exp(-x * 9) * 0.5;
        }
      }),
    );
  }
  // The music ducks around each chime.
  const musicGain = (sec) => chimes.reduce((g, c) => Math.min(g, sec < c - 0.4 ? 1 : sec < c ? 1 - (sec - (c - 0.4)) / 0.4 * 0.8 : sec < c + 1.8 ? 0.2 : sec < c + 2.6 ? 0.2 + ((sec - c - 1.8) / 0.8) * 0.8 : 1), 1);

  // ---------------------------------------------------------------- master
  const fadeIn = at(1.2);
  const fadeOut = at(3);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fadeIn) * Math.min(1, (n - i) / fadeOut) * musicGain(i / SR);
    outL[i] = Math.tanh((L[i] + wetL[i] * 0.55) * g * 1.2) + chimeL[i] * 0.8;
    outR[i] = Math.tanh((R[i] + wetR[i] * 0.55) * g * 1.2) + chimeL[i] * 0.8;
    peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  }
  const norm = 0.89 / peak; // about -1 dBFS
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  const clip = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(clip(outL[i] * norm), 44 + i * 4);
    buf.writeInt16LE(clip(outR[i] * norm), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
  return file;
}

if (require.main === module) {
  const secs = Number(process.argv[2]) || 40;
  console.log(write(secs, process.argv[3] || 'music.wav', { hits: [4, 12, 20], chimes: [26] }));
}
module.exports = { write };
