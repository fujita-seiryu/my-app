"use strict";

/* =========================================================
   定数・音名データ
   ========================================================= */

// 移動ド（クロマチック12音）。短調（御詠歌）では半音位置3が「ミ#」、8が「ラ#」と表示名が変わる
const CHROMATIC_JP = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];

// 長調・短調のスケール構成音（基準音からの半音数）。短調は御詠歌の音階（ド・レ・ミ・ミ#・ファ・ソ・ラ・ラ#・シ）
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 4, 5, 7, 8, 9, 11];

function getDegreeLabel(degreeIndex) {
  if (state.scaleType === "minor") {
    if (degreeIndex === 3) return "ミ#";
    if (degreeIndex === 8) return "ラ#";
  }
  return CHROMATIC_JP[degreeIndex];
}

// イロハニホヘト基準音（半音= Cからの半音数）。標準ピアノの全音/半音配置に沿って並べる
const BASE_NOTES_CORE = [
  { label: "イ", semitone: 9 },
  { label: "嬰イ", semitone: 10 },
  { label: "ロ", semitone: 11 },
  { label: "ハ", semitone: 0 },
  { label: "嬰ハ", semitone: 1 },
  { label: "ニ", semitone: 2 },
  { label: "嬰ニ", semitone: 3 },
  { label: "ホ", semitone: 4 },
  { label: "ヘ", semitone: 5 },
  { label: "嬰ヘ", semitone: 6 },
  { label: "ト", semitone: 7 },
  { label: "嬰ト", semitone: 8 },
];

// 男女の声域差に対応するため、各基準音を3オクターブ（低音/基準/高音）で選択できるようにする
const OCTAVE_VARIANTS = [
  { suffix: "ー", octaveShift: -1 },
  { suffix: "", octaveShift: 0 },
  { suffix: "＋", octaveShift: 1 },
];

const BASE_NOTES = [];
BASE_NOTES_CORE.forEach((core) => {
  OCTAVE_VARIANTS.forEach((variant) => {
    BASE_NOTES.push({
      label: core.label + variant.suffix,
      semitone: core.semitone,
      octaveShift: variant.octaveShift,
    });
  });
});
const DEFAULT_BASE_INDEX = BASE_NOTES.findIndex((n) => n.label === "ハ");

const C4_FREQ = 261.6255653005986;

// ピッチ検出パラメータ（声域全体をカバーするため広めに設定。声域外はここで自然にカットされる）
// RMS_THRESHOLD（マイク感度の音量ゲート）は端末差が大きいため、詳細設定スライダーで可変にする
const CLARITY_THRESHOLD = 0.35;
const MIN_VOICE_FREQ = 55;
const MAX_VOICE_FREQ = 1100;

// 検出感度スライダー（1=低感度～10=高感度）とRMS_THRESHOLDの対応
const SENSITIVITY_MIN = 1;
const SENSITIVITY_MAX = 10;
const DEFAULT_SENSITIVITY = 6; // 従来のRMS_THRESHOLD=0.01相当
const DEFAULT_PLAYBACK_VOLUME = 30; // %。従来の再生ゲイン0.3相当

function computeRmsThreshold(sensitivity) {
  return 0.02 - (sensitivity - 1) * 0.002;
}

/* =========================================================
   状態
   ========================================================= */

const state = {
  audioCtx: null,
  analyser: null,
  timeDomainBuf: null,
  baseFreq: C4_FREQ,
  scaleType: "major",
  displayedDegree: -1,
  displayedOctaveBand: "base",
  degreeCandidate: -1,
  degreeCandidateCount: 0,
  smoothedCents: 0,
  rmsThreshold: computeRmsThreshold(DEFAULT_SENSITIVITY),
  playbackVolume: DEFAULT_PLAYBACK_VOLUME / 100,
  metro: {
    running: false,
    bpm: 92,
    beatsPerBar: 2,
    currentBeat: 0,
    nextNoteTime: 0,
    timerId: null,
  },
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

/* =========================================================
   DOM参照
   ========================================================= */

const el = {
  baseNote: document.getElementById("baseNote"),
  scaleType: document.getElementById("scaleType"),
  micOverlay: document.getElementById("micOverlay"),
  micStartBtn: document.getElementById("micStartBtn"),
  flatArrow: document.getElementById("flatArrow"),
  sharpArrow: document.getElementById("sharpArrow"),
  noteName: document.getElementById("noteName"),
  centValue: document.getElementById("centValue"),
  freqValue: document.getElementById("freqValue"),
  noteRing: document.getElementById("noteRing"),
  micLevelBar: document.getElementById("micLevelBar"),
  bpmSlider: document.getElementById("bpmSlider"),
  bpmInput: document.getElementById("bpmInput"),
  beatDots: document.getElementById("beatDots"),
  metroToggle: document.getElementById("metroToggle"),
  advSettingsToggle: document.getElementById("advSettingsToggle"),
  advSettingsPanel: document.getElementById("advSettingsPanel"),
  sensitivitySlider: document.getElementById("sensitivitySlider"),
  sensitivityValue: document.getElementById("sensitivityValue"),
  volumeSlider: document.getElementById("volumeSlider"),
  volumeValue: document.getElementById("volumeValue"),
};

/* =========================================================
   初期化: UI構築
   ========================================================= */

function buildBaseNoteOptions() {
  BASE_NOTES.forEach((note, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = note.label;
    el.baseNote.appendChild(opt);
  });
  el.baseNote.value = String(DEFAULT_BASE_INDEX);
}

function computeBaseFreq() {
  const idx = Number(el.baseNote.value);
  const note = BASE_NOTES[idx];
  state.baseFreq = C4_FREQ * Math.pow(2, note.semitone / 12) * Math.pow(2, note.octaveShift);
}

// VT-12実機のように12音を円状に配置（i=0のドを12時位置、時計回り）
const RING_RADIUS_PERCENT = 39;

function buildNoteRing() {
  const ringCenter = el.noteRing.querySelector(".ring-center");
  CHROMATIC_JP.forEach((_, i) => {
    const angleDeg = -90 + i * 30;
    const rad = (angleDeg * Math.PI) / 180;
    const x = 50 + RING_RADIUS_PERCENT * Math.cos(rad);
    const y = 50 + RING_RADIUS_PERCENT * Math.sin(rad);

    const note = document.createElement("div");
    note.className = "ring-note";
    note.dataset.degree = String(i);
    note.textContent = getDegreeLabel(i);
    note.style.left = `${x}%`;
    note.style.top = `${y}%`;
    el.noteRing.insertBefore(note, ringCenter);

    // タップしている間、その音階の基準ピッチをプレビュー再生する
    note.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      note.classList.add("playing");
      playDegreePreview(i);
    });
    const stopPreview = () => {
      note.classList.remove("playing");
      stopDegreePreview();
    };
    note.addEventListener("pointerup", stopPreview);
    note.addEventListener("pointerleave", stopPreview);
    note.addEventListener("pointercancel", stopPreview);
  });
}

// オクターブ位置による点灯色: 基準オクターブ内=赤、1オクターブ以上上=ピンク、下回る=黄
const BAND_COLOR_VARS = { base: "var(--red)", above: "var(--pink)", below: "var(--yellow)" };

function updateNoteRingHighlight() {
  const steps = state.scaleType === "major" ? MAJOR_STEPS : MINOR_STEPS;
  const notes = el.noteRing.querySelectorAll(".ring-note");
  notes.forEach((note, i) => {
    note.textContent = getDegreeLabel(i);
    note.classList.toggle("in-scale", steps.includes(i));
    const isActive = i === state.displayedDegree;
    note.classList.toggle("active", isActive);
    note.classList.toggle("oct-base", isActive && state.displayedOctaveBand === "base");
    note.classList.toggle("oct-above", isActive && state.displayedOctaveBand === "above");
    note.classList.toggle("oct-below", isActive && state.displayedOctaveBand === "below");
  });
}

function updateFlatSharpArrows(cents) {
  const FLAT_SHARP_THRESHOLD = 8;
  el.flatArrow.classList.toggle("lit", cents < -FLAT_SHARP_THRESHOLD);
  el.sharpArrow.classList.toggle("lit", cents > FLAT_SHARP_THRESHOLD);
}

function buildBeatDots() {
  el.beatDots.innerHTML = "";
  const n = state.metro.beatsPerBar;
  for (let i = 0; i < n; i++) {
    const dot = document.createElement("div");
    dot.className = "beat-dot" + (i === 0 ? " accent" : "");
    el.beatDots.appendChild(dot);
  }
}

/* =========================================================
   ピッチ検出（自己相関法）
   ========================================================= */

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < state.rmsThreshold) return -1;

  const minLag = Math.floor(sampleRate / MAX_VOICE_FREQ);
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_VOICE_FREQ), SIZE - 2);

  let energy = 0;
  for (let i = 0; i < SIZE; i++) energy += buf[i] * buf[i];

  const corr = new Float32Array(maxLag + 2);
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < SIZE - lag; i++) sum += buf[i] * buf[i + lag];
    corr[lag] = sum;
    if (sum > bestCorr) {
      bestCorr = sum;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return -1;
  const confidence = bestCorr / energy;
  if (confidence < CLARITY_THRESHOLD) return -1;

  const c0 = corr[bestLag - 1] || 0;
  const c1 = corr[bestLag];
  const c2 = corr[bestLag + 1] || 0;
  const denom = c0 - 2 * c1 + c2;
  const shift = denom !== 0 ? 0.5 * (c0 - c2) / denom : 0;
  const refinedLag = bestLag + shift;

  return sampleRate / refinedLag;
}

/* =========================================================
   表示更新ループ
   ========================================================= */

function setNoSignalDisplay() {
  el.noteName.textContent = "‐";
  el.noteName.style.color = "var(--text-dim)";
  el.centValue.textContent = "‐";
  el.freqValue.textContent = "‐";
  el.flatArrow.classList.remove("lit");
  el.sharpArrow.classList.remove("lit");
  state.displayedDegree = -1;
  updateNoteRingHighlight();
}

function processPitch(freq) {
  if (freq <= 0) {
    setNoSignalDisplay();
    state.degreeCandidateCount = 0;
    return;
  }

  const semitoneOffsetRaw = 12 * Math.log2(freq / state.baseFreq);
  const nearestSemitone = Math.round(semitoneOffsetRaw);
  const cents = (semitoneOffsetRaw - nearestSemitone) * 100;
  const degreeIndex = ((nearestSemitone % 12) + 12) % 12;
  const octaveOffset = Math.floor(nearestSemitone / 12);
  const octaveBand = octaveOffset === 0 ? "base" : octaveOffset > 0 ? "above" : "below";

  // ちらつき防止: 3フレーム連続で同じ音になったら表示を切り替える
  if (degreeIndex === state.degreeCandidate) {
    state.degreeCandidateCount++;
  } else {
    state.degreeCandidate = degreeIndex;
    state.degreeCandidateCount = 1;
  }
  if (state.degreeCandidateCount >= 3) {
    state.displayedDegree = degreeIndex;
    state.displayedOctaveBand = octaveBand;
  }
  if (state.displayedDegree === -1) return;

  state.smoothedCents = state.smoothedCents * 0.6 + cents * 0.4;

  el.noteName.textContent = getDegreeLabel(state.displayedDegree);
  el.noteName.style.color = BAND_COLOR_VARS[state.displayedOctaveBand];
  el.centValue.textContent = `${state.smoothedCents >= 0 ? "+" : ""}${Math.round(state.smoothedCents)}¢`;
  el.freqValue.textContent = `${freq.toFixed(1)}Hz`;
  updateFlatSharpArrows(state.smoothedCents);
  updateNoteRingHighlight();
}

function pitchLoop() {
  requestAnimationFrame(pitchLoop);
  if (!state.analyser) return;

  state.analyser.getFloatTimeDomainData(state.timeDomainBuf);

  let peak = 0;
  for (let i = 0; i < state.timeDomainBuf.length; i++) {
    const v = Math.abs(state.timeDomainBuf[i]);
    if (v > peak) peak = v;
  }
  el.micLevelBar.style.width = `${Math.min(100, peak * 140)}%`;

  const freq = autoCorrelate(state.timeDomainBuf, state.audioCtx.sampleRate);
  processPitch(freq);
}

/* =========================================================
   ピッチ再生（リングをタップしている間、基準ピッチをプレビュー再生）
   ========================================================= */

let activePreview = null; // { osc, gain }

function ensureAudioCtx() {
  if (!state.audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioCtx();
  }
  return state.audioCtx;
}

function playDegreePreview(degreeIndex) {
  const ctx = ensureAudioCtx();
  stopDegreePreview();

  const freq = state.baseFreq * Math.pow(2, degreeIndex / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(state.playbackVolume, now + 0.015);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);

  activePreview = { osc, gain };
}

function stopDegreePreview() {
  if (!activePreview) return;
  const ctx = state.audioCtx;
  const { osc, gain } = activePreview;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.08);
  osc.stop(now + 0.09);
  activePreview = null;
}

/* =========================================================
   詳細設定（検出感度・再生音量。端末ごとにlocalStorageへ保存）
   ========================================================= */

const SETTINGS_STORAGE_KEY = "vt12_settings_v1";

function loadUserSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUserSettings() {
  try {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        sensitivity: Number(el.sensitivitySlider.value),
        volume: Number(el.volumeSlider.value),
      })
    );
  } catch {
    // localStorageが使えない環境では保存をあきらめる
  }
}

function applySensitivity(sliderValue) {
  state.rmsThreshold = computeRmsThreshold(sliderValue);
  el.sensitivityValue.textContent = String(sliderValue);
}

function applyPlaybackVolume(sliderValue) {
  state.playbackVolume = sliderValue / 100;
  el.volumeValue.textContent = `${sliderValue}%`;
}

function initAdvSettings() {
  const saved = loadUserSettings();
  const sensitivity = saved && saved.sensitivity ? saved.sensitivity : DEFAULT_SENSITIVITY;
  const volume = saved && saved.volume != null ? saved.volume : DEFAULT_PLAYBACK_VOLUME;

  el.sensitivitySlider.value = String(sensitivity);
  el.volumeSlider.value = String(volume);
  applySensitivity(sensitivity);
  applyPlaybackVolume(volume);

  el.advSettingsToggle.addEventListener("click", () => {
    el.advSettingsPanel.classList.toggle("hidden");
  });
  el.sensitivitySlider.addEventListener("input", () => {
    applySensitivity(Number(el.sensitivitySlider.value));
    saveUserSettings();
  });
  el.volumeSlider.addEventListener("input", () => {
    applyPlaybackVolume(Number(el.volumeSlider.value));
    saveUserSettings();
  });
}

/* =========================================================
   マイク開始
   ========================================================= */

async function startMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    ensureAudioCtx();

    const source = state.audioCtx.createMediaStreamSource(stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    state.timeDomainBuf = new Float32Array(state.analyser.fftSize);
    source.connect(state.analyser);

    el.micOverlay.classList.add("hidden");
    el.metroToggle.disabled = false;

    requestAnimationFrame(pitchLoop);
  } catch (err) {
    alert("マイクにアクセスできませんでした: " + err.message);
  }
}

/* =========================================================
   メトロノーム（lookaheadスケジューリング）
   ========================================================= */

function scheduleClick(beatIndex, time) {
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const isAccent = beatIndex === 0;

  osc.frequency.value = isAccent ? 1500 : 1000;
  gain.gain.setValueAtTime(isAccent ? 0.6 : 0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.07);

  const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
  setTimeout(() => flashBeatDot(beatIndex), delayMs);
}

function flashBeatDot(beatIndex) {
  const dots = el.beatDots.children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.remove("on");
  if (dots[beatIndex]) {
    dots[beatIndex].classList.add("on");
    setTimeout(() => dots[beatIndex].classList.remove("on"), 100);
  }
}

function metroScheduler() {
  const m = state.metro;
  while (m.nextNoteTime < state.audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleClick(m.currentBeat, m.nextNoteTime);
    const secondsPerBeat = 60.0 / m.bpm;
    m.nextNoteTime += secondsPerBeat;
    m.currentBeat = (m.currentBeat + 1) % m.beatsPerBar;
  }
}

function startMetronome() {
  const m = state.metro;
  m.currentBeat = 0;
  m.nextNoteTime = state.audioCtx.currentTime + 0.05;
  m.running = true;
  m.timerId = setInterval(metroScheduler, LOOKAHEAD_MS);
  el.metroToggle.textContent = "停止";
  el.metroToggle.classList.add("running");
}

function stopMetronome() {
  const m = state.metro;
  m.running = false;
  clearInterval(m.timerId);
  m.timerId = null;
  el.metroToggle.textContent = "開始";
  el.metroToggle.classList.remove("running");
  const dots = el.beatDots.children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.remove("on");
}

/* =========================================================
   イベント配線
   ========================================================= */

function wireEvents() {
  el.micStartBtn.addEventListener("click", startMic);

  el.baseNote.addEventListener("change", computeBaseFreq);
  el.scaleType.addEventListener("change", () => {
    state.scaleType = el.scaleType.value;
    updateNoteRingHighlight();
  });

  el.bpmSlider.addEventListener("input", () => {
    state.metro.bpm = Number(el.bpmSlider.value);
    el.bpmInput.value = el.bpmSlider.value;
  });
  el.bpmInput.addEventListener("change", () => {
    let v = Math.max(40, Math.min(240, Number(el.bpmInput.value) || 92));
    el.bpmInput.value = v;
    el.bpmSlider.value = v;
    state.metro.bpm = v;
  });

  el.metroToggle.addEventListener("click", () => {
    if (!state.audioCtx) return;
    if (state.metro.running) stopMetronome();
    else startMetronome();
  });
}

/* =========================================================
   起動
   ========================================================= */

function init() {
  buildBaseNoteOptions();
  computeBaseFreq();
  buildNoteRing();
  updateNoteRingHighlight();
  buildBeatDots();
  el.metroToggle.disabled = true;
  wireEvents();
  initAdvSettings();
}

init();
