// Renders every theme x sound from synth.js to wav, then ogg (Android), caf (macOS) and mp3 (web).
const { SOUNDS, render, SR } = require('./synth.js');
const fs = require('fs'), { execFileSync } = require('child_process');
const out = __dirname + '/sounds';
for (const d of ['wav', 'ogg', 'caf', 'mp3']) fs.mkdirSync(`${out}/${d}`, { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const manifest = { sounds: [], themes: [], clips: {} };
for (const [name, meaning, takes] of SOUNDS) {
  manifest.sounds.push({ name, meaning });
  for (const [theme, [desc, events]] of Object.entries(takes)) {
    if (!manifest.themes.includes(theme)) manifest.themes.push(theme);
    const y = render(events), n = y.length, id = `kc_${theme}_${name}`;
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, y[i])) * 32767), 44 + i * 2);
    const wav = `${out}/wav/${id}.wav`;
    fs.writeFileSync(wav, b);
    ff('-i', wav, '-c:a', 'libvorbis', '-q:a', '5', `${out}/ogg/${id}.ogg`);
    ff('-i', wav, '-c:a', 'pcm_s16le', '-f', 'caf', `${out}/caf/${id}.caf`);
    ff('-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', `${out}/mp3/${id}.mp3`);
    manifest.clips[id] = { theme, sound: name, desc, seconds: +(n / SR).toFixed(2) };
  }
}
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(manifest.themes.join(' '), Object.keys(manifest.clips).length);
