// On-device face reading with Google MediaPipe (free; nothing leaves the phone).
// Emits { present, x, y, mood, smile, frown, surprise, lookingAway } about 15×/sec.

const VER = '1.2.3';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const ema = (prev, next, k = 0.35) => prev + (next - prev) * k;

export class FaceReader extends EventTarget {
  constructor() {
    super();
    this.state = { present: false, x: 0, y: 0, mood: 'absent', smile: 0, frown: 0, surprise: 0, lookingAway: false };
    this.running = false;
    this.turn = null;
  }

  async start(video) {
    this.video = video;
    if (!this.landmarker) {
      const { FaceLandmarker, FilesetResolver } = await import(`${BASE}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const make = (delegate) =>
        FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
      try {
        this.landmarker = await make('GPU');
      } catch {
        this.landmarker = await make('CPU');
      }
    }
    this.running = true;
    this.lastTs = 0;
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.state = { ...this.state, present: false, mood: 'absent' };
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('update', { detail: this.state }));
  }

  tick() {
    if (!this.running) return;
    const v = this.video;
    if (v && v.readyState >= 2 && v.videoWidth) {
      const ts = performance.now();
      if (ts > this.lastTs) {
        this.lastTs = ts;
        try {
          this.read(this.landmarker.detectForVideo(v, ts));
        } catch {
          /* skip frame */
        }
      }
    }
    this.timer = setTimeout(() => this.tick(), 66);
  }

  read(res) {
    const s = this.state;
    const lm = res.faceLandmarks?.[0];
    if (!lm) {
      this.missing = (this.missing || 0) + 1;
      if (this.missing > 8) Object.assign(s, { present: false, mood: 'absent' });
      this.record();
      return this.emit();
    }
    this.missing = 0;
    const bs = {};
    for (const c of res.faceBlendshapes?.[0]?.categories || []) bs[c.categoryName] = c.score;
    const avg = (a, b) => ((bs[a] || 0) + (bs[b] || 0)) / 2;

    // Face position (mirrored, so it matches what the user sees) and head turn
    const nose = lm[1];
    const left = lm[234];
    const right = lm[454];
    const yaw = (nose.x - left.x) / Math.max(0.01, right.x - left.x) - 0.5; // ~0 when facing camera
    s.x = ema(s.x, -(nose.x - 0.5) * 2);
    s.y = ema(s.y, (nose.y - 0.45) * 2);
    s.present = true;
    s.smile = ema(s.smile, avg('mouthSmileLeft', 'mouthSmileRight'));
    s.frown = ema(s.frown, avg('mouthFrownLeft', 'mouthFrownRight') * 0.6 + avg('browDownLeft', 'browDownRight') * 0.7);
    s.surprise = ema(s.surprise, Math.min(bs.browInnerUp || 0, 1) * 0.5 + avg('eyeWideLeft', 'eyeWideRight') * 0.5 + (bs.jawOpen || 0) * 0.4);
    const lookSide = Math.max(avg('eyeLookOutLeft', 'eyeLookInLeft'), avg('eyeLookOutRight', 'eyeLookInRight'));
    s.lookingAway = Math.abs(yaw) > 0.22 || lookSide > 0.65;

    s.mood =
      s.lookingAway ? 'away'
      : s.smile > 0.45 ? 'smiling'
      : s.surprise > 0.55 ? 'surprised'
      : s.frown > 0.35 ? 'frowning'
      : 'neutral';
    this.record();
    this.emit();
  }

  // Tally moods during the user's turn so the AI gets a summary.
  beginTurn() {
    this.turn = { smiling: 0, frowning: 0, surprised: 0, away: 0, neutral: 0, absent: 0, n: 0 };
  }
  record() {
    if (!this.turn) this.beginTurn();
    this.turn[this.state.mood] = (this.turn[this.state.mood] || 0) + 1;
    this.turn.n++;
  }
  // → 'smiling' | 'frowning' | 'surprised' | 'looking away' | 'neutral' | null
  summary() {
    const t = this.turn;
    if (!this.running || !t || t.n < 5) return null;
    const share = (k) => t[k] / t.n;
    if (share('absent') > 0.7) return null;
    if (share('smiling') > 0.3) return 'smiling';
    if (share('frowning') > 0.3) return 'frowning';
    if (share('surprised') > 0.25) return 'surprised';
    if (share('away') > 0.5) return 'looking away';
    return 'neutral';
  }
}
