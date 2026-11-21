// Runs the free Kokoro neural voice off the main thread so animation stays smooth.
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null;

async function load() {
  const tryLoad = (device) =>
    KokoroTTS.from_pretrained(MODEL, {
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      device,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total > 5e6) {
          self.postMessage({ type: 'progress', loaded: p.loaded, total: p.total });
        }
      },
    });
  if ('gpu' in navigator) {
    try {
      tts = await tryLoad('webgpu');
      return 'webgpu';
    } catch {
      /* fall back to wasm */
    }
  }
  tts = await tryLoad('wasm');
  return 'wasm';
}

self.onmessage = async (e) => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      const device = await load();
      self.postMessage({ type: 'ready', device });
    } else if (type === 'speak') {
      if (!tts) throw new Error('not loaded');
      const out = await tts.generate(e.data.text, { voice: e.data.voice, speed: e.data.speed || 1 });
      const audio = out.audio;
      self.postMessage({ type: 'audio', id, audio, sr: out.sampling_rate }, [audio.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err?.message || err) });
  }
};
