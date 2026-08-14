"use strict";

/* =========================================================
   定数・音名データ
   ========================================================= */

// 基準音（音名）12種類。半音= Cからの半音数。標準ピアノの全音/半音配置に沿って並べる
// ホ-ヘ間、ロ-ハ間はもともと半音のため「ホ#」「ロ#」は存在しない
const NOTE_NAMES = [
  { label: "イ", semitone: 9 },
  { label: "イ#", semitone: 10 },
  { label: "ロ", semitone: 11 },
  { label: "ハ", semitone: 0 },
  { label: "ハ#", semitone: 1 },
  { label: "ニ", semitone: 2 },
  { label: "ニ#", semitone: 3 },
  { label: "ホ", semitone: 4 },
  { label: "ヘ", semitone: 5 },
  { label: "ヘ#", semitone: 6 },
  { label: "ト", semitone: 7 },
  { label: "ト#", semitone: 8 },
];
const DEFAULT_NOTE_INDEX = NOTE_NAMES.findIndex((n) => n.label === "ハ");

// オクターブ層：基準／ー1（1つ下）／ー2（2つ下）の3段階
// 「基準」は御詠歌の楽譜上の基準（記譜音）、「ー1」はおおむね女性キー、「ー2」はおおむね男性キー相当
const OCTAVE_LAYERS = [
  { label: "基準", shift: 0 },
  { label: "ー1", shift: -1 },
  { label: "ー2", shift: -2 },
];
const DEFAULT_OCTAVE_INDEX = 0;

// 円形メーターの9区画（実機VT-12のシール配置をそのまま再現。周波数距離には比例させない）
// 画面上の配置順（時計回り、12時=ミ/ファの継ぎ目）: ファ→ソ→ラ短→ラ→シ→ド→レ→ミ短→ミ
// 「ミ短」「ラ短」は、御詠歌で転調した際に使う音（実際に使うコンダクター実機で周波数を確認済み）。
// ミ短はレ#相当（semitone 3）、ラ短はソ#相当（semitone 8）。曲中で長調/短調どちらの音も
// 切り替えなしにいつでも選べるよう、常設の区画として持つ（トグル切り替え方式は廃止）。
const NINE_POSITIONS = [
  { label: "ファ", semitone: 5 },
  { label: "ソ", semitone: 7 },
  { label: "ラ短", semitone: 8 },
  { label: "ラ", semitone: 9 },
  { label: "シ", semitone: 11 },
  { label: "ド", semitone: 0 },
  { label: "レ", semitone: 2 },
  { label: "ミ短", semitone: 3 },
  { label: "ミ", semitone: 4 },
];

// 円形メーターは実機同様12区画（30°ずつ）の枠を基準とし、9つのラベルをその中に配置する。
// 残り3枠（ド-レ間・ファ-ソ間・ラ-シ間）は実機でも使わない半音のため空白のまま残す。
// 値はNINE_POSITIONSのインデックス。nullは空白マス。
const RING_SLOTS = [0, null, 1, 2, 3, null, 4, 5, null, 6, 7, 8];

// となえ練習で使う音名→半音差（「ド」を0とした相対値）。移動ドの基準「ド」からの音程を表す。
const DEGREE_SEMITONES = { ド: 0, レ: 2, ミ: 4, ファ: 5, ソ: 7, ラ: 9, シ: 11 };

// となえ練習パターン（全8種を予定）。degreeは音名（ドレミ…）、octは基準「ド」から見た相対オクターブ
// （0=基準、1=1つ上、-1=1つ下）。nullは1拍分の休止。bpmはこのパターン専用の拍速。
// パターン2〜8は内容が決まり次第、1つずつ追加していく（現時点ではnull＝準備中）。
const CHANT_PATTERNS = [
  {
    bpm: 45,
    notes: [
      { degree: "ド", oct: 0 },
      { degree: "レ", oct: 0 },
      { degree: "ミ", oct: 0 },
      { degree: "ソ", oct: 0 },
      { degree: "ラ", oct: 0 },
      { degree: "ド", oct: 1 },
      { degree: "レ", oct: 1 },
      { degree: "ミ", oct: 1 },
      null,
      { degree: "ミ", oct: 1 },
      { degree: "ド", oct: 1 },
      { degree: "ラ", oct: 0 },
      { degree: "ソ", oct: 0 },
      { degree: "ミ", oct: 0 },
      { degree: "レ", oct: 0 },
      { degree: "ド", oct: 0 },
    ],
  },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

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

// 購入者向け合言葉（軽い不正利用対策。BASEの購入完了メールで案内する）
const ACCESS_CODE = "sonaeru-vt12";
const LOCK_STORAGE_KEY = "vt12_unlocked_v1";

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
  displayedDegreeIndices: [], // NINE_POSITIONS内でハイライト中のインデックス（同じsemitoneが重複した場合は複数）
  displayedOctaveBand: "base",
  degreeCandidate: null, // ちらつき防止の安定判定キー（実音のsemitone値＝オクターブ込み）
  degreeCandidateCount: 0,
  smoothedCents: 0,
  rmsThreshold: computeRmsThreshold(DEFAULT_SENSITIVITY),
  playbackVolume: DEFAULT_PLAYBACK_VOLUME / 100,
  metro: {
    running: false,
    bpm: 50,
    beatsPerBar: 2, // 常に2固定（拍子切り替えボタンは撤去済み。設計書v12参照）
    doubleSpeed: false, // ONの間、同じ拍子パターンを2倍の速さで刻む（裏拍込みで基本4回→倍速8回）
    currentBeat: 0,
    nextNoteTime: 0,
    timerId: null,
  },
  chant: {
    activeIndex: null, // 再生中のとなえ練習パターンの番号（0〜7）。再生していなければnull
    timers: [], // setTimeoutのID一覧（停止時にまとめてclearTimeoutする）
    activeNotes: [], // 現在鳴っている{osc, gain}の一覧（途中停止時に即フェードアウトさせる）
  },
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

/* =========================================================
   DOM参照
   ========================================================= */

const el = {
  baseNote: document.getElementById("baseNote"),
  octaveLayer: document.getElementById("octaveLayer"),
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
  doubleSpeedToggle: document.getElementById("doubleSpeedToggle"),
  metroToggle: document.getElementById("metroToggle"),
  advSettingsToggle: document.getElementById("advSettingsToggle"),
  advSettingsPanel: document.getElementById("advSettingsPanel"),
  sensitivitySlider: document.getElementById("sensitivitySlider"),
  sensitivityValue: document.getElementById("sensitivityValue"),
  volumeSlider: document.getElementById("volumeSlider"),
  volumeValue: document.getElementById("volumeValue"),
  lockOverlay: document.getElementById("lockOverlay"),
  lockCodeInput: document.getElementById("lockCodeInput"),
  lockSubmitBtn: document.getElementById("lockSubmitBtn"),
  lockError: document.getElementById("lockError"),
  chantGrid: document.getElementById("chantGrid"),
};

/* =========================================================
   初期化: UI構築
   ========================================================= */

function buildBaseNoteOptions() {
  NOTE_NAMES.forEach((note, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = note.label;
    el.baseNote.appendChild(opt);
  });
  el.baseNote.value = String(DEFAULT_NOTE_INDEX);
}

function buildOctaveLayerOptions() {
  OCTAVE_LAYERS.forEach((layer, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = layer.label;
    el.octaveLayer.appendChild(opt);
  });
  el.octaveLayer.value = String(DEFAULT_OCTAVE_INDEX);
}

function computeBaseFreq() {
  const note = NOTE_NAMES[Number(el.baseNote.value)];
  const layer = OCTAVE_LAYERS[Number(el.octaveLayer.value)];
  state.baseFreq = C4_FREQ * Math.pow(2, note.semitone / 12) * Math.pow(2, layer.shift);
}

// プレビュー再生専用の基準周波数。iPhone等の内蔵スピーカーは超低域の再生が苦手で、
// 「ー2」（基準より2オクターブ下）だとほぼ聞こえなくなってしまうため、プレビュー再生時だけ
// 「ー1」相当の周波数を使う（実際に耳で確認し、違和感がないことを確認済み）。
// ピッチ検出・判定に使うstate.baseFreqはそのまま変更しない。
function computePreviewBaseFreq() {
  const note = NOTE_NAMES[Number(el.baseNote.value)];
  const layer = OCTAVE_LAYERS[Number(el.octaveLayer.value)];
  const previewShift = layer.shift <= -2 ? -1 : layer.shift;
  return C4_FREQ * Math.pow(2, note.semitone / 12) * Math.pow(2, previewShift);
}

// 実機同様12区画（30°ずつ）を円状に配置し、そのうち9区画にラベルを置く（残り3区画は空白）
const RING_RADIUS_PERCENT = 39;
const RING_START_ANGLE_DEG = -70; // ファの位置（12時から時計回りに20度）
const RING_STEP_DEG = 30; // 360° / 12区画

function buildNoteRing() {
  const ringCenter = el.noteRing.querySelector(".ring-center");
  RING_SLOTS.forEach((posIndex, slot) => {
    if (posIndex === null) return; // 空白マス（ド-レ間・ファ-ソ間・ラ-シ間など実機で使わない半音の位置）

    const pos = NINE_POSITIONS[posIndex];
    const angleDeg = RING_START_ANGLE_DEG + slot * RING_STEP_DEG;
    const rad = (angleDeg * Math.PI) / 180;
    const x = 50 + RING_RADIUS_PERCENT * Math.cos(rad);
    const y = 50 + RING_RADIUS_PERCENT * Math.sin(rad);

    const note = document.createElement("div");
    note.className = "ring-note";
    note.dataset.index = String(posIndex);
    note.textContent = pos.label;
    note.style.left = `${x}%`;
    note.style.top = `${y}%`;
    el.noteRing.insertBefore(note, ringCenter);

    // タップしている間、その区画の基準ピッチをプレビュー再生する
    note.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      note.classList.add("playing");
      playDegreePreview(posIndex);
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

// オクターブ位置による点灯色: 基準オクターブ内=赤、上=青、下=黄
const BAND_COLOR_VARS = { base: "var(--red)", above: "var(--blue)", below: "var(--yellow)" };

function updateNoteRingHighlight() {
  const notes = el.noteRing.querySelectorAll(".ring-note");
  notes.forEach((note) => {
    const i = Number(note.dataset.index);
    const isActive = state.displayedDegreeIndices.includes(i);
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

// 画面のドット表示は表拍（オンビート）の数だけ（基本：2個、倍速：4個）。
// 実際に鳴る音（裏拍込み）は表拍数の2倍あり、表拍・裏拍のすべてのタイミングでドットが
// 順番に1回ずつ光る。アクセント（1・3拍目など）のドットは必ず表拍で黄色に、
// 非アクセントのドットは必ず裏拍で白に光る（scheduleClick参照）。
function buildBeatDots() {
  el.beatDots.innerHTML = "";
  const onbeatCount = state.metro.beatsPerBar * (state.metro.doubleSpeed ? 2 : 1);
  for (let i = 0; i < onbeatCount; i++) {
    const dot = document.createElement("div");
    const isAccent = i % state.metro.beatsPerBar === 0;
    dot.className = "beat-dot" + (isAccent ? " accent" : "");
    el.beatDots.appendChild(dot);
  }
}

// 拍子は常に2拍子（タンタン、強弱）固定。以前は「2拍子／4拍子」を切り替えるボタンもあったが、
// 「倍速」1つのボタンで足りるため撤去し、beatsPerBarは常に2で固定する（設計書v12参照）。

// 倍速（ON時、同じ拍子パターンを2倍の速さで刻む）。裏拍込みで、基本時は4回、倍速ONでは8回鳴る。
// 切り替え時は小節の頭に戻す（currentBeatをリセット）。
function setDoubleSpeed(on) {
  state.metro.doubleSpeed = on;
  state.metro.currentBeat = 0;
  el.doubleSpeedToggle.classList.toggle("active", on);
  buildBeatDots();
}

function toggleDoubleSpeed() {
  setDoubleSpeed(!state.metro.doubleSpeed);
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
   9区画への割り当て判定
   ========================================================= */

// semitoneOffsetRaw（基準ドからの連続的な半音差）に対して、NINE_POSITIONS内で
// 最も近い区画を探す。同距離の区画が複数あれば両方を返す。オクターブ違いも含めて広めに探索する。
function matchNinePositions(semitoneOffsetRaw) {
  let bestDist = Infinity;
  let candidates = [];
  for (let oct = -3; oct <= 3; oct++) {
    NINE_POSITIONS.forEach((pos, i) => {
      const candidate = pos.semitone + oct * 12;
      const dist = Math.abs(semitoneOffsetRaw - candidate);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        candidates = [{ index: i, octave: oct, candidate }];
      } else if (Math.abs(dist - bestDist) < 1e-9) {
        candidates.push({ index: i, octave: oct, candidate });
      }
    });
  }
  return { candidates, bestDist };
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
  state.displayedDegreeIndices = [];
  updateNoteRingHighlight();
}

function processPitch(freq) {
  if (freq <= 0) {
    setNoSignalDisplay();
    state.degreeCandidateCount = 0;
    return;
  }

  const semitoneOffsetRaw = 12 * Math.log2(freq / state.baseFreq);
  const { candidates } = matchNinePositions(semitoneOffsetRaw);
  const primary = candidates[0];
  const cents = (semitoneOffsetRaw - primary.candidate) * 100;
  const octaveBand = primary.octave === 0 ? "base" : primary.octave > 0 ? "above" : "below";

  // ちらつき防止: 3フレーム連続で同じ音（実音のsemitone値）になったら表示を切り替える
  const stabilityKey = primary.candidate;
  if (stabilityKey === state.degreeCandidate) {
    state.degreeCandidateCount++;
  } else {
    state.degreeCandidate = stabilityKey;
    state.degreeCandidateCount = 1;
  }
  if (state.degreeCandidateCount >= 3) {
    state.displayedDegreeIndices = candidates.map((c) => c.index);
    state.displayedOctaveBand = octaveBand;
  }
  if (state.displayedDegreeIndices.length === 0) return;

  state.smoothedCents = state.smoothedCents * 0.6 + cents * 0.4;

  const labelText = state.displayedDegreeIndices
    .map((i) => NINE_POSITIONS[i].label)
    .join("/");
  el.noteName.textContent = labelText;
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
  if (state.audioCtx.state === "suspended") {
    // iOSはユーザー操作の直後でないとAudioContextが再開しないことがあるため、明示的にresumeする
    state.audioCtx.resume();
  }
  return state.audioCtx;
}

function playDegreePreview(posIndex) {
  const ctx = ensureAudioCtx();
  stopDegreePreview();

  const semitone = NINE_POSITIONS[posIndex].semitone;
  const freq = computePreviewBaseFreq() * Math.pow(2, semitone / 12);
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
   合言葉ロック画面（購入者向けの軽い不正利用対策）
   ========================================================= */

function isUnlocked() {
  try {
    return localStorage.getItem(LOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setUnlocked() {
  try {
    localStorage.setItem(LOCK_STORAGE_KEY, "1");
  } catch {
    // localStorageが使えない環境では毎回入力が必要になる
  }
}

function tryUnlock() {
  const value = el.lockCodeInput.value.trim();
  if (value === ACCESS_CODE) {
    setUnlocked();
    el.lockOverlay.classList.add("hidden");
    el.lockError.textContent = "";
    init();
  } else {
    el.lockError.textContent = "合言葉が違います";
    el.lockCodeInput.value = "";
    el.lockCodeInput.focus();
  }
}

function initLockScreen() {
  if (isUnlocked()) {
    el.lockOverlay.classList.add("hidden");
    init();
    return;
  }

  el.lockOverlay.classList.remove("hidden");
  el.lockSubmitBtn.addEventListener("click", tryUnlock);
  el.lockCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });
  el.lockCodeInput.focus();
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

// subIndex: 偶数=表拍（元の拍。1・3拍目などがアクセント）、奇数=裏拍（表拍と表拍の間に挟む控えめな音）。
// 画面のドットは表拍の数だけ（通常2個・倍速4個）だが、点滅は表拍・裏拍の全イベントを
// ドットの並びに順番に（余りで）割り当てて光らせる。ドット数は常に偶数のため、
// 偶数番目のドット（アクセント）には必ず表拍だけが、奇数番目のドット（非アクセント）には
// 必ず裏拍だけが割り当たり、CSSのbeat-dot.accent.onで自動的に黄（表拍）／白（裏拍）に分かれる。
function scheduleClick(subIndex, time) {
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const isOnbeat = subIndex % 2 === 0;
  const beatIndex = Math.floor(subIndex / 2);
  let freq, level;
  if (isOnbeat) {
    // 通常速度（倍速OFF）では表拍の音を強拍/弱拍で区別せず、常に同じ音（ピン）にする。
    // 倍速ONのときは従来どおり1・3打目（強拍）と2・4打目（弱拍）を区別する。
    const isAccent = state.metro.doubleSpeed
      ? beatIndex % state.metro.beatsPerBar === 0
      : true;
    freq = isAccent ? 1500 : 1000;
    level = isAccent ? 0.6 : 0.35;
  } else {
    // 裏拍：表拍よりさらに控えめな音（低め・小さめ）にして表拍と区別できるようにする
    freq = 700;
    level = 0.2;
  }

  osc.frequency.value = freq;
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.07);

  const dotCount = state.metro.beatsPerBar * (state.metro.doubleSpeed ? 2 : 1);
  const dotIndex = subIndex % dotCount;
  const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
  setTimeout(() => flashBeatDot(dotIndex), delayMs);
}

// 表拍・裏拍いずれのタイミングでも、渡されたドットを1回だけ光らせる
// （黄色/白の色分けはCSSのbeat-dot.accent.onで自動的に行われる。scheduleClick参照）。
function flashBeatDot(dotIndex) {
  const dot = el.beatDots.children[dotIndex];
  if (!dot) return;
  dot.classList.remove("on");
  void dot.offsetWidth; // 連続で光らせる場合でもアニメーションを再トリガーする
  dot.classList.add("on");
  setTimeout(() => dot.classList.remove("on"), 100);
}

function metroScheduler() {
  const m = state.metro;
  // 表拍数（拍子×倍速）に対し、各表拍の間に裏拍を1つ挟むため、実際に鳴らすスロット数は表拍数の2倍。
  // BPMの数値・意味（表拍の間隔）自体は変えず、その中間に裏拍を追加するだけ。
  const onbeatCount = m.beatsPerBar * (m.doubleSpeed ? 2 : 1);
  const totalSubSlots = onbeatCount * 2;
  const secondsPerOnbeat = (60.0 / m.bpm) / (m.doubleSpeed ? 2 : 1);
  const secondsPerSubSlot = secondsPerOnbeat / 2;
  while (m.nextNoteTime < state.audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleClick(m.currentBeat, m.nextNoteTime);
    m.nextNoteTime += secondsPerSubSlot;
    m.currentBeat = (m.currentBeat + 1) % totalSubSlots;
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
   となえ練習（ピッチ音を聞きながら一緒に唱える練習。全8パターン予定）
   ========================================================= */

// 基準「ド」からの相対音程（degree・oct）を実際の周波数に変換する。
// プレビュー再生（playDegreePreview）と同じく、iPhone内蔵スピーカーでも聞こえるよう
// computePreviewBaseFreq（「ー2」を「ー1」相当に補正した基準周波数）を使う。
function computeChantNoteFreq(note) {
  const semitone = DEGREE_SEMITONES[note.degree];
  return computePreviewBaseFreq() * Math.pow(2, semitone / 12) * Math.pow(2, note.oct);
}

// 音名リング上で、指定した音名（ドレミ…）に対応する要素を探す
function findChantRingEl(degree) {
  const posIndex = NINE_POSITIONS.findIndex((p) => p.label === degree);
  if (posIndex < 0) return null;
  return el.noteRing.querySelector(`.ring-note[data-index="${posIndex}"]`);
}

function clearChantTimers() {
  state.chant.timers.forEach((id) => clearTimeout(id));
  state.chant.timers = [];
}

// 再生途中で停止された場合、鳴っている音をすぐにフェードアウトして止める
function stopChantImmediate() {
  const ctx = state.audioCtx;
  state.chant.activeNotes.forEach(({ osc, gain }) => {
    try {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);
      osc.stop(now + 0.06);
    } catch {
      // 既に再生が終わっているオシレーターへの二重stop呼び出しは無視する
    }
  });
  state.chant.activeNotes = [];
}

function resetChantUI() {
  document.querySelectorAll(".ring-note.chant-target").forEach((n) => n.classList.remove("chant-target"));
  document.querySelectorAll(".chant-btn.playing").forEach((b) => b.classList.remove("playing"));
}

function stopChantPattern() {
  clearChantTimers();
  stopChantImmediate();
  resetChantUI();
  state.chant.activeIndex = null;
}

// パターン内の全ノートを事前にまとめてスケジューリングする（曲全体が短いためlookahead方式は不要）。
// レガート：各音は次の音の直前まで伸ばし、ポップ音防止のためごく短いアタック/リリースだけ付ける。
// 各ノートの発音区間に合わせ、音名リングの対応区画に`chant-target`クラスを付け外しして
// 「今どの音が鳴っているか」を緑の光で示す（マイクで検出した実際の声の色付け＝activeとは別枠の表示）。
function playChantPattern(patternIndex, btnEl) {
  const pattern = CHANT_PATTERNS[patternIndex];
  if (!pattern) return; // 準備中のパターン

  if (state.chant.activeIndex === patternIndex) {
    // 再生中の同じボタンをもう一度押したら停止する
    stopChantPattern();
    return;
  }
  stopChantPattern(); // 別のパターンが再生中なら止めてから切り替える

  const ctx = ensureAudioCtx();
  state.chant.activeIndex = patternIndex;
  btnEl.classList.add("playing");

  const beatDuration = 60 / pattern.bpm;
  const noteGap = 0.03; // 次の音との間に置くごく短い無音（ポップ音防止）
  const startDelay = 0.05;
  const now = ctx.currentTime;

  pattern.notes.forEach((note, i) => {
    if (!note) return; // 休止（音を鳴らさない）

    const startTime = now + startDelay + i * beatDuration;
    const endTime = startTime + beatDuration - noteGap;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = computeChantNoteFreq(note);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(state.playbackVolume, startTime + 0.02);
    gain.gain.setValueAtTime(state.playbackVolume, endTime - 0.03);
    gain.gain.linearRampToValueAtTime(0, endTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(endTime + 0.02);

    const noteRef = { osc, gain };
    state.chant.activeNotes.push(noteRef);

    const ringEl = findChantRingEl(note.degree);
    const onDelayMs = Math.max(0, (startTime - ctx.currentTime) * 1000);
    const offDelayMs = Math.max(0, (endTime - ctx.currentTime) * 1000);

    state.chant.timers.push(
      setTimeout(() => {
        if (ringEl) ringEl.classList.add("chant-target");
      }, onDelayMs)
    );
    state.chant.timers.push(
      setTimeout(() => {
        if (ringEl) ringEl.classList.remove("chant-target");
        const idx = state.chant.activeNotes.indexOf(noteRef);
        if (idx >= 0) state.chant.activeNotes.splice(idx, 1);
      }, offDelayMs)
    );
  });

  const totalDurationMs = (startDelay + pattern.notes.length * beatDuration) * 1000;
  state.chant.timers.push(
    setTimeout(() => {
      resetChantUI();
      state.chant.activeIndex = null;
    }, totalDurationMs + 50)
  );
}

/* =========================================================
   イベント配線
   ========================================================= */

function wireEvents() {
  el.micStartBtn.addEventListener("click", startMic);

  el.baseNote.addEventListener("change", computeBaseFreq);
  el.octaveLayer.addEventListener("change", computeBaseFreq);

  el.bpmSlider.addEventListener("input", () => {
    state.metro.bpm = Number(el.bpmSlider.value);
    el.bpmInput.value = el.bpmSlider.value;
  });
  el.bpmInput.addEventListener("change", () => {
    let v = Math.max(30, Math.min(90, Number(el.bpmInput.value) || 50));
    el.bpmInput.value = v;
    el.bpmSlider.value = v;
    state.metro.bpm = v;
  });

  el.doubleSpeedToggle.addEventListener("click", toggleDoubleSpeed);

  el.metroToggle.addEventListener("click", () => {
    if (!state.audioCtx) return;
    if (state.metro.running) stopMetronome();
    else startMetronome();
  });

  el.chantGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".chant-btn");
    if (!btn || btn.disabled) return;
    playChantPattern(Number(btn.dataset.patternIndex), btn);
  });
}

/* =========================================================
   起動
   ========================================================= */

function init() {
  buildBaseNoteOptions();
  buildOctaveLayerOptions();
  computeBaseFreq();
  buildNoteRing();
  updateNoteRingHighlight();
  setDoubleSpeed(state.metro.doubleSpeed);
  el.metroToggle.disabled = true;
  wireEvents();
  initAdvSettings();
}

initLockScreen();
