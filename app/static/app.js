"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const LANGS = [
  ["vi", "Tiếng Việt"], ["en", "English"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"],
  ["th", "ไทย"], ["id", "Indonesia"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"],
  ["pt", "Português"], ["ru", "Русский"], ["it", "Italiano"], ["hi", "हिन्दी"], ["ar", "العربية"],
];
const SAMPLE = {
  vi: "Xin chào, đây là giọng đọc thử nghiệm cho video của bạn.",
  en: "Hello! This is a sample voice for your video.",
  zh: "你好，这是为你的视频准备的示例声音。",
  ja: "こんにちは、これはあなたの動画のためのサンプル音声です。",
  ko: "안녕하세요, 영상을 위한 샘플 음성입니다.",
  fr: "Bonjour, voici une voix d'exemple pour votre vidéo.",
  es: "Hola, esta es una voz de ejemplo para tu video.",
  de: "Hallo, das ist eine Beispielstimme für dein Video.",
};
const COLORS = ["#ffd84d", "#ff9ec7", "#8fd3ff", "#8ff0b8", "#c5b2ff", "#ffb37a", "#ff8a8a", "#b5f2ff"];
const MAX_CARDS = 240;
const FAST_CPS = 17;           // characters/second above which a line is hard to read aloud in time
const RATES = [0.75, 1, 1.25, 1.5, 2];

const state = {
  file: null,
  job: null,
  segments: [],
  engines: [],
  tab: "all",
  voices: {},          // engine id -> Voice[]
  voiceLoads: {},      // engine id -> Promise
  cast: [],            // [{engine, id, name, lang, gender, color}]
  gender: "",
  audio: null,
  playingBtn: null,
  cc: true,
  src: "source",
  sourceUrl: null,
  resultUrl: null,
  resultBurned: false,
};

/* ------------------------------------------------------------------ utils */
const base = (code) => (code || "").replace("_", "-").split("-")[0].toLowerCase();
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
};
const clock = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}:${mm}` : mm;
};
const parseTime = (str) => String(str).split(":").map(Number).reduce((acc, p) => acc * 60 + p, 0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const langName = (code) => code === "*" ? "Đa ngôn ngữ" : (LANGS.find(([c]) => c === base(code))?.[1] || code);
const voiceKey = (v) => `${v.engine}:${v.id}`;
const engineName = (id) => state.engines.find((e) => e.id === id)?.name || id;
const engineOk = (id) => !!state.engines.find((e) => e.id === id && e.available);
const targetLang = () => base(state.job?.language || $("#dstLang").value || "vi");

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res;
}

function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ saved settings */
const SETTINGS_KEY = "vocalize:settings";
const SAVED_INPUTS = ["model", "dstLang", "speed", "voiceVol", "keepOrig", "origVol", "autoFit",
  "subSize", "subColor", "subBox", "bilingual"];

function saveSettings() {
  const data = { cast: state.cast, mode: castMode(), subMode: subMode() };
  for (const id of SAVED_INPUTS) {
    const el = $(`#${id}`);
    data[id] = el.type === "checkbox" ? el.checked : el.value;
  }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch {}
}

function loadSettings() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch {}
  if (!data) return;
  for (const id of SAVED_INPUTS) {
    const el = $(`#${id}`);
    if (data[id] === undefined || !el) continue;
    if (el.type === "checkbox") el.checked = !!data[id];
    else el.value = data[id];
  }
  if (Array.isArray(data.cast)) state.cast = data.cast;
  const mode = $(`input[name=mode][value=${data.mode}]`);
  if (mode) mode.checked = true;
  const sm = $(`input[name=subMode][value=${data.subMode}]`);
  if (sm) sm.checked = true;
}

const castMode = () => $("input[name=mode]:checked").value;
const subMode = () => $("input[name=subMode]:checked").value;

/* ------------------------------------------------------------------ steps */
function setStep(n) {
  $$(".step").forEach((el) => {
    const s = +el.dataset.step;
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  for (let i = 2; i <= 4; i++) $(`#step${i}`).classList.toggle("locked", !state.job?.segments?.length && !state.segments.length);
}

function setProgress(el, p, text, kind = "") {
  el.classList.remove("hidden", "err", "ok");
  if (kind) el.classList.add(kind);
  $(".bar", el).style.width = `${Math.round(p * 100)}%`;
  $("span", el).textContent = text;
}

function updateHint() {
  let msg;
  if (!state.file) msg = "👉 Bắt đầu bằng cách tải video lên ở bước 1.";
  else if (!state.segments.length) msg = "👉 Bấm <b>Tạo phụ đề tự động</b> để nhận dạng lời thoại.";
  else if (!state.cast.length) msg = "👉 Sửa phụ đề nếu cần, rồi chọn <b>giọng đọc</b> ở bước 3 (thử mục <b>Gợi ý nhanh</b>).";
  else if (!state.resultUrl) msg = "👉 Mọi thứ đã sẵn sàng — bấm <b>Tạo video lồng tiếng</b> ở bước 4.";
  else msg = "🎉 Video đã xong! Chuyển <b>Gốc / Kết quả</b> ở trên để so sánh, hoặc tải về ở bước 4.";
  $("#nextHint").innerHTML = msg;
}

/* ------------------------------------------------------------------ step 1: upload */
function initUpload() {
  for (const [code, name] of LANGS) {
    $("#srcLang").add(new Option(name, code));
    $("#dstLang").add(new Option(name, code));
  }
  const dz = $("#dropzone");
  const input = $("#fileInput");
  input.addEventListener("change", () => input.files[0] && pickFile(input.files[0]));
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => e.dataTransfer.files[0] && pickFile(e.dataTransfer.files[0]));
  $("#btnTranscribe").addEventListener("click", startTranscribe);
  $("#dstLang").addEventListener("change", () => { saveSettings(); if (!state.job) refreshVoiceLang(); });
  $("#model").addEventListener("change", saveSettings);
}

function pickFile(file) {
  state.file = file;
  $("#dzFile").textContent = `📹 ${file.name} · ${(file.size / 1048576).toFixed(1)} MB · bấm để đổi`;
  $("#dropzone").classList.add("has-file");
  $("#btnTranscribe").disabled = false;
  state.sourceUrl = URL.createObjectURL(file);
  state.resultUrl = null;
  $("#srcToggle").classList.add("hidden");
  setSource("source");
  updateHint();
}

async function startTranscribe() {
  const btn = $("#btnTranscribe");
  btn.disabled = true;
  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("model", $("#model").value);
  fd.append("language", $("#srcLang").value);
  fd.append("translate_to", $("#dstLang").value);
  if ($("#srtInput").files[0]) fd.append("srt", $("#srtInput").files[0]);

  const prog = $("#prog1");
  setProgress(prog, 0, "Đang tải video lên máy chủ...");
  try {
    const job = await uploadWithProgress(fd, (p) => setProgress(prog, p * 0.3, `Đang tải lên ${Math.round(p * 100)}%`));
    state.job = job;
    const done = await poll(job.id, (j) => setProgress(prog, 0.3 + j.progress * 0.7, j.message || "Đang xử lý..."), ["ready"]);
    state.job = done;
    state.segments = done.segments.map((s) => ({ ...s, cast: null }));
    setProgress(prog, 1, `✅ ${done.message}`, "ok");
    if (done.warning) toast(`⚠ ${done.warning}`, 8000);
    afterSegmentsLoaded();
    $("#step2").scrollIntoView({ block: "start" });
  } catch (e) {
    setProgress(prog, 1, `❌ ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function afterSegmentsLoaded() {
  renderMeta();
  renderSegments();
  setStep(2);
  const hasOrig = state.segments.some((s) => s.original);
  $("#expBi").classList.toggle("hidden", !hasOrig);
  $("#expOrig").classList.toggle("hidden", !hasOrig);
  $("#biWrap").classList.toggle("disabled", !hasOrig);
  refreshVoiceLang();
  renderQuick();
  updateHint();
}

function uploadWithProgress(fd, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(body) : reject(new Error(body.detail || `Lỗi ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối tới máy chủ"));
    xhr.send(fd);
  });
}

async function poll(id, onTick, until) {
  for (;;) {
    const job = await (await api(`/api/jobs/${id}`)).json();
    onTick(job);
    if (job.status === "error") throw new Error(job.error || "Có lỗi xảy ra");
    if (until.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 800));
  }
}

function renderMeta() {
  const j = state.job;
  const bits = [`⏱ ${clock(j.duration)}`, `💬 ${state.segments.length} câu`];
  if (j.source_language) bits.push(`🗣 ${langName(j.source_language)}`);
  if (j.language && base(j.language) !== base(j.source_language)) bits.push(`🌐 → ${langName(j.language)}`);
  $("#meta").innerHTML = bits.map((b) => `<span>${esc(b)}</span>`).join("");
}

/* ------------------------------------------------------------------ player */
const video = () => $("#video");

function setSource(kind) {
  state.src = kind;
  const v = video();
  const url = kind === "result" ? state.resultUrl : state.sourceUrl;
  if (!url) return;
  const t = v.currentTime || 0;
  v.src = url;
  v.addEventListener("loadedmetadata", () => { if (t < v.duration) v.currentTime = t; }, { once: true });
  $("#playerEmpty").classList.add("hidden");
  $("#bigPlay").classList.remove("hidden");
  $$("#srcToggle button").forEach((b) => b.classList.toggle("on", b.dataset.src === kind));
  // A burned-in result already shows subtitles; avoid drawing them twice.
  setCC(kind === "result" && state.resultBurned ? false : state.cc);
}

function setCC(on) {
  state.cc = on;
  $("#cCC").classList.toggle("on", on);
  updateOverlay();
}

function initPlayer() {
  const v = video();
  const play = () => (v.paused ? v.play() : v.pause());
  v.addEventListener("click", play);
  $("#bigPlay").addEventListener("click", play);
  $("#cPlay").addEventListener("click", play);
  v.addEventListener("play", () => { $("#cPlay").textContent = "⏸"; $("#bigPlay").classList.add("hidden"); });
  v.addEventListener("pause", () => { $("#cPlay").textContent = "▶"; });
  v.addEventListener("timeupdate", onTime);
  v.addEventListener("loadedmetadata", () => { onTime(); renderMarks(); });
  $("#cPrev").addEventListener("click", () => jumpSentence(-1));
  $("#cNext").addEventListener("click", () => jumpSentence(1));
  $("#cMute").addEventListener("click", () => { v.muted = !v.muted; syncVol(); });
  $("#cVol").addEventListener("input", (e) => { v.volume = +e.target.value; v.muted = v.volume === 0; syncVol(); });
  $("#cRate").addEventListener("click", () => {
    const next = RATES[(RATES.indexOf(v.playbackRate) + 1) % RATES.length] || 1;
    v.playbackRate = next;
    $("#cRate").textContent = `${next}×`;
  });
  $("#cCC").addEventListener("click", () => setCC(!state.cc));
  $("#cFull").addEventListener("click", toggleFullscreen);
  $$("#srcToggle button").forEach((b) => b.addEventListener("click", () => setSource(b.dataset.src)));
  new ResizeObserver(updateOverlay).observe($("#player"));

  // Timeline: click / drag to seek, hover to see time + sentence.
  const tl = $("#timeline");
  const ratioAt = (e) => {
    const r = tl.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };
  let dragging = false;
  tl.addEventListener("pointerdown", (e) => {
    if (!v.duration) return;
    dragging = true;
    tl.setPointerCapture(e.pointerId);
    v.currentTime = ratioAt(e) * v.duration;
  });
  tl.addEventListener("pointermove", (e) => {
    if (!v.duration) return;
    const t = ratioAt(e) * v.duration;
    if (dragging) v.currentTime = t;
    const seg = segAt(t);
    const tip = $("#tlTip");
    tip.textContent = `${clock(t)}${seg ? " · " + seg.text : ""}`;
    tip.style.left = `${Math.min(Math.max(ratioAt(e) * 100, 12), 88)}%`;
    tip.classList.remove("hidden");
  });
  tl.addEventListener("pointerup", () => { dragging = false; });
  tl.addEventListener("pointerleave", () => $("#tlTip").classList.add("hidden"));
}

function syncVol() {
  const v = video();
  $("#cMute").textContent = v.muted || v.volume === 0 ? "🔇" : v.volume < 0.5 ? "🔉" : "🔊";
  $("#cVol").value = v.muted ? 0 : v.volume;
}

function toggleFullscreen() {
  const p = $("#player");
  if (document.fullscreenElement) document.exitFullscreen();
  else p.requestFullscreen?.();
}

function onTime() {
  const v = video();
  const d = v.duration || state.job?.duration || 0;
  const pct = d ? (v.currentTime / d) * 100 : 0;
  $("#tlFill").style.width = `${pct}%`;
  $("#tlHead").style.left = `${pct}%`;
  $("#cTime").textContent = `${clock(v.currentTime)} / ${clock(d)}`;
  updateOverlay();
  highlightSegment(v.currentTime);
}

/* Sentence on screen at time t; when two touch, the one that just started wins. */
function segAt(t) {
  for (let i = state.segments.length - 1; i >= 0; i--) {
    const s = state.segments[i];
    if (t >= s.start && t <= s.end) return s;
  }
  return null;
}

function currentIndex(t) {
  let idx = -1;
  state.segments.forEach((s, i) => { if (s.start <= t + 0.05) idx = i; });
  return idx;
}

function jumpSentence(dir) {
  const v = video();
  if (!state.segments.length) { v.currentTime = Math.max(0, v.currentTime + dir * 5); return; }
  let i = currentIndex(v.currentTime);
  if (dir < 0 && i >= 0 && v.currentTime - state.segments[i].start > 1) i += 1; // restart current first
  const target = state.segments[Math.min(Math.max(i + dir, 0), state.segments.length - 1)];
  v.currentTime = target.start;
}

function playAt(t) {
  const v = video();
  if (!v.src) return;
  v.currentTime = t;
  v.play();
}

function updateOverlay() {
  const ov = $("#subOverlay");
  const v = video();
  const seg = state.cc && v.src ? segAt(v.currentTime) : null;
  if (!seg) { ov.innerHTML = ""; return; }
  // Mirror the burn-in style: ASS FontSize is relative to a 288px-high canvas.
  const h = $("#player").clientHeight || 200;
  const px = Math.max(10, (+$("#subSize").value || 18) / 288 * h);
  const color = $("#subColor").value;
  ov.classList.toggle("box", $("#subBox").checked);
  const orig = $("#bilingual").checked && seg.original && seg.original !== seg.text
    ? `<span class="orig" style="color:${color}">${esc(seg.original)}</span>` : "";
  ov.style.fontSize = `${px}px`;
  ov.innerHTML = `<span style="color:${color}">${esc(seg.text)}</span>${orig}`;
}

function renderMarks() {
  const d = video().duration || state.job?.duration || 0;
  const box = $("#tlMarks");
  if (!d) { box.innerHTML = ""; return; }
  box.innerHTML = state.segments.map((s, i) => {
    const v = resolveVoice(i);
    return `<i style="left:${(s.start / d) * 100}%;width:${((s.end - s.start) / d) * 100}%;background:${v ? v.color : "#fff"}"></i>`;
  }).join("");
}

function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
    const v = video();
    if (!v.src) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (k === "j") jumpSentence(-1);
    else if (k === "l") jumpSentence(1);
    else if (k === "arrowleft") { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (k === "arrowright") { e.preventDefault(); v.currentTime += 5; }
    else if (k === "c") setCC(!state.cc);
    else if (k === "f") toggleFullscreen();
  });
  $("#kbdHint").addEventListener("click", () => $("#kbdPanel").classList.toggle("hidden"));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#kbdHint, #kbdPanel")) $("#kbdPanel").classList.add("hidden");
  });
}

/* ------------------------------------------------------------------ step 2: segments */
function renderSegments() {
  const q = $("#segSearch").value.trim().toLowerCase();
  const box = $("#segments");
  box.innerHTML = "";
  $("#segCount").textContent = `${state.segments.length} câu`;
  state.segments.forEach((seg, i) => {
    if (q && !`${seg.text} ${seg.original || ""}`.toLowerCase().includes(q)) return;
    const el = document.createElement("div");
    el.className = "seg";
    el.dataset.i = i;
    const voice = resolveVoice(i);
    const dur = Math.max(seg.end - seg.start, 0.1);
    const cps = seg.text.length / dur;
    el.style.borderLeftColor = voice ? voice.color : "var(--ink)";
    el.innerHTML = `
      <div class="seg-time">
        <button class="jump" title="Phát từ câu này">▶ ${fmt(seg.start)}</button>
        <input value="${fmt(seg.start)}" data-k="start" title="Bắt đầu" aria-label="Bắt đầu">
        <input value="${fmt(seg.end)}" data-k="end" title="Kết thúc" aria-label="Kết thúc">
        <span class="seg-dur">${dur.toFixed(1)}s</span>
      </div>
      <div class="seg-body">
        <textarea rows="2" aria-label="Nội dung câu ${i + 1}">${esc(seg.text)}</textarea>
        ${seg.original ? `<div class="seg-orig">${esc(seg.original)}</div>` : ""}
        <div class="seg-foot">
          <select title="Giọng đọc cho câu này">${castOptions(seg.cast)}</select>
          ${cps > FAST_CPS ? `<span class="badge-warn" title="Câu dài so với thời lượng (${cps.toFixed(0)} ký tự/giây). Giọng sẽ được đọc nhanh hơn — nên rút gọn câu.">⚡ dài</span>` : ""}
          <span class="grow"></span>
          <button class="icon" data-act="listen" title="Nghe thử câu này">🔊</button>
          <button class="icon" data-act="merge" title="Gộp với câu sau">⤵</button>
          <button class="icon" data-act="split" title="Thêm câu phía sau">＋</button>
          <button class="icon del" data-act="del" title="Xoá câu">✕</button>
        </div>
      </div>`;
    $("textarea", el).addEventListener("input", (e) => { seg.text = e.target.value; updateOverlay(); });
    $("textarea", el).addEventListener("change", () => renderSummary());
    $$(".seg-time input", el).forEach((inp) => inp.addEventListener("change", () => {
      const v = parseTime(inp.value);
      if (!Number.isNaN(v)) seg[inp.dataset.k] = v;
      if (seg.end < seg.start) [seg.start, seg.end] = [seg.end, seg.start];
      state.segments.sort((a, b) => a.start - b.start);
      renderSegments();
    }));
    $(".jump", el).addEventListener("click", () => playAt(seg.start));
    $("select", el).addEventListener("change", (e) => {
      seg.cast = e.target.value === "" ? null : +e.target.value;
      if (seg.cast !== null) $("input[name=mode][value=manual]").checked = true;
      renderSegments();
    });
    $("[data-act=listen]", el).addEventListener("click", (e) => {
      const v = resolveVoice(i);
      if (!v) { toast("Hãy chọn ít nhất một giọng ở bước 3"); return; }
      previewVoice(v, seg.text, e.currentTarget);
    });
    $("[data-act=merge]", el).addEventListener("click", () => {
      const next = state.segments[i + 1];
      if (!next) return toast("Đây là câu cuối");
      seg.end = next.end;
      seg.text = `${seg.text} ${next.text}`.trim();
      if (seg.original || next.original) seg.original = `${seg.original || ""} ${next.original || ""}`.trim();
      state.segments.splice(i + 1, 1);
      renderSegments();
    });
    $("[data-act=split]", el).addEventListener("click", () => {
      const next = state.segments[i + 1];
      const start = seg.end;
      const end = next ? Math.max(start + 0.5, next.start) : start + 2;
      state.segments.splice(i + 1, 0, { start, end, text: "", cast: null });
      renderSegments();
      $(`.seg[data-i="${i + 1}"] textarea`)?.focus();
    });
    $("[data-act=del]", el).addEventListener("click", () => {
      state.segments.splice(i, 1);
      renderSegments();
    });
    box.appendChild(el);
  });
  if (!box.children.length) box.innerHTML = `<div class="empty">${q ? "Không tìm thấy câu nào" : "Chưa có phụ đề"}</div>`;
  renderMarks();
  updateOverlay();
  renderSummary();
}

function castOptions(selected) {
  const auto = `<option value="">🤖 Tự động${state.cast.length ? "" : " (chưa có giọng)"}</option>`;
  return auto + state.cast.map((c, k) =>
    `<option value="${k}" ${selected === k ? "selected" : ""}>${k + 1}. ${esc(c.name)} · ${esc(engineName(c.engine))}</option>`).join("");
}

function resolveVoice(i) {
  if (!state.cast.length) return null;
  const seg = state.segments[i];
  if (seg && seg.cast !== null && seg.cast !== undefined && state.cast[seg.cast]) return state.cast[seg.cast];
  if (castMode() === "rotate") return state.cast[i % state.cast.length];
  return state.cast[0];
}

function highlightSegment(t) {
  let active = null;
  const cur = segAt(t);
  $$(".seg").forEach((el) => {
    const on = !!cur && state.segments[+el.dataset.i] === cur;
    el.classList.toggle("playing", on);
    if (on) active = el;
  });
  // Follow playback in the list, unless the user is editing something there.
  if (active && !video().paused && !$("#segments").contains(document.activeElement)) {
    const box = $("#segments");
    const top = active.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - active.offsetHeight) {
      box.scrollTo({ top: top - 20, behavior: "smooth" });
    }
  }
}

/* Subtitle export happens in the browser, so it works before rendering the video. */
function srtTime(t, sep = ",") {
  const ms = Math.round(Math.max(t, 0) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
}

function exportSubs(kind) {
  const segs = state.segments.filter((s) => s.text.trim());
  if (!segs.length) return toast("Chưa có phụ đề để xuất");
  const stem = (state.file?.name || state.job?.filename || "video").replace(/\.[^.]+$/, "");
  const lang = base(state.job?.language) || "sub";
  const textOf = (s) => {
    if (kind === "orig") return (s.original || s.text).trim();
    if (kind === "bi" && s.original && s.original !== s.text) return `${s.text.trim()}\n${s.original.trim()}`;
    return s.text.trim();
  };
  if (kind === "txt") {
    download(`${stem}.${lang}.txt`, segs.map(textOf).join("\n"));
  } else if (kind === "vtt") {
    download(`${stem}.${lang}.vtt`, "WEBVTT\n\n" + segs.map((s) => `${srtTime(s.start, ".")} --> ${srtTime(s.end, ".")}\n${textOf(s)}\n`).join("\n"), "text/vtt");
  } else {
    const suffix = kind === "bi" ? `${lang}.song-ngu` : kind === "orig" ? base(state.job?.source_language) || "goc" : lang;
    download(`${stem}.${suffix}.srt`, segs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${textOf(s)}\n`).join("\n"), "application/x-subrip");
  }
  toast(`⬇ Đã xuất ${segs.length} câu phụ đề`);
}

function initSegments() {
  $("#segSearch").addEventListener("input", renderSegments);
  $("#btnAddSeg").addEventListener("click", () => {
    const t = video().currentTime || 0;
    const last = state.segments.at(-1);
    const start = state.segments.some((s) => t >= s.start && t <= s.end) || !t ? (last ? last.end : 0) : t;
    state.segments.push({ start, end: start + 2, text: "", cast: null });
    state.segments.sort((a, b) => a.start - b.start);
    renderSegments();
    const idx = state.segments.findIndex((s) => s.start === start && !s.text);
    $(`.seg[data-i="${idx}"] textarea`)?.focus();
  });
  $("#btnReplace").addEventListener("click", () => {
    const find = $("#segSearch").value;
    if (!find) return toast("Nhập từ cần tìm vào ô tìm kiếm trước");
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let n = 0;
    for (const s of state.segments) {
      s.text = s.text.replace(re, () => { n++; return $("#segReplace").value; });
    }
    $("#segSearch").value = "";
    renderSegments();
    toast(n ? `Đã thay ${n} chỗ` : "Không tìm thấy từ cần thay");
  });
  $$("[data-export]").forEach((b) => b.addEventListener("click", () => exportSubs(b.dataset.export)));
}

/* ------------------------------------------------------------------ step 3: voices */
function loadVoices(id) {
  if (!state.voiceLoads[id]) {
    state.voiceLoads[id] = api(`/api/voices/${id}`).then((r) => r.json()).then((list) => {
      state.voices[id] = list;
      return list;
    }).catch((e) => { delete state.voiceLoads[id]; throw e; });
  }
  return state.voiceLoads[id];
}

async function loadEngines() {
  state.engines = await (await api("/api/engines")).json();
  renderTabs();
  selectTab("all");
  // Warm up the voice lists in the background so tab counts and quick picks appear.
  await Promise.allSettled(state.engines.filter((e) => e.available).map((e) => loadVoices(e.id).then(renderTabs)));
  renderQuick();
  syncCast();
}

function countFor(id) {
  const lang = $("#voiceLang").value;
  const list = id === "all" ? Object.values(state.voices).flat() : state.voices[id] || [];
  return list.filter((v) => !lang || v.lang === "*" || base(v.lang) === lang).length;
}

function renderTabs() {
  const box = $("#engines");
  box.innerHTML = "";
  const mk = (id, label, ok, title) => {
    const b = document.createElement("button");
    b.className = `tab ${state.tab === id ? "on" : ""} ${ok ? "" : "off"}`;
    b.dataset.id = id;
    const n = ok ? countFor(id) : 0;
    b.innerHTML = `${esc(label)} ${ok ? (n ? `<small>${n}</small>` : "") : "<small>chưa cài</small>"}`;
    b.title = title;
    b.addEventListener("click", () => selectTab(id));
    box.appendChild(b);
  };
  mk("all", "⭐ Tất cả", true, "Mọi giọng từ mọi nguồn đã cài");
  for (const e of state.engines) mk(e.id, e.name, e.available, e.description);
}

async function selectTab(id) {
  state.tab = id;
  $$("#engines .tab").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  const e = state.engines.find((x) => x.id === id);
  const info = $("#engineInfo");
  if (id === "all") {
    info.innerHTML = "⭐ Gộp giọng từ mọi nguồn đã cài, lọc sẵn theo ngôn ngữ phụ đề. Chọn một nguồn để xem riêng.";
  } else {
    const link = e.repo.includes("/") && !e.repo.includes(".")
      ? `<a href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener">github.com/${esc(e.repo)}</a>`
      : `<a href="https://${esc(e.repo)}" target="_blank" rel="noopener">${esc(e.repo)}</a>`;
    info.innerHTML = `<b>${esc(e.name)}</b> · ${link} · ${e.needs_network ? "🌐 cần internet" : "💻 chạy offline"}<br>${esc(e.description)}`
      + (e.available ? "" : `<br>⚠ Chưa cài. Cài đặt: <code>${esc(e.install_hint)}</code>`);
  }
  if (id !== "all" && !e.available) { $("#voices").innerHTML = ""; $("#voiceCount").textContent = ""; return; }
  $("#voices").innerHTML = `<div class="empty">⏳ Đang tải danh sách giọng...</div>`;
  const ids = id === "all" ? state.engines.filter((x) => x.available).map((x) => x.id) : [id];
  const results = await Promise.allSettled(ids.map(loadVoices));
  if (state.tab !== id) return;
  const failed = results.map((r, k) => r.status === "rejected" ? `${engineName(ids[k])}: ${r.reason.message}` : null).filter(Boolean);
  if (failed.length && id !== "all") {
    $("#voices").innerHTML = `<div class="empty">❌ ${esc(failed[0])}</div>`;
    return;
  }
  if (failed.length) toast(`⚠ ${failed.join(" · ")}`, 6000);
  fillLangFilter();
  renderVoices();
}

function tabVoices() {
  if (state.tab === "all") return state.engines.filter((e) => e.available).flatMap((e) => state.voices[e.id] || []);
  return state.voices[state.tab] || [];
}

function fillLangFilter() {
  const sel = $("#voiceLang");
  const want = sel.dataset.want ?? targetLang();
  const langs = new Map();
  for (const v of tabVoices()) {
    if (v.lang === "*") continue;
    const b = base(v.lang);
    langs.set(b, (langs.get(b) || 0) + 1);
  }
  sel.innerHTML = "";
  sel.add(new Option("🌍 Mọi ngôn ngữ", ""));
  [...langs.entries()].sort((a, b) => (b[0] === "vi") - (a[0] === "vi") || langName(a[0]).localeCompare(langName(b[0])))
    .forEach(([c, n]) => sel.add(new Option(`${langName(c)} (${n})`, c)));
  sel.value = langs.has(want) ? want : "";
}

function refreshVoiceLang() {
  delete $("#voiceLang").dataset.want;
  fillLangFilter();
  renderVoices();
  renderTabs();
}

function renderVoices() {
  const q = $("#voiceSearch").value.trim().toLowerCase();
  const lang = $("#voiceLang").value;
  const list = tabVoices().filter((v) =>
    (!lang || v.lang === "*" || base(v.lang) === lang) &&
    (!state.gender || v.gender === state.gender) &&
    (!q || `${v.name} ${v.id} ${v.lang} ${v.tags.join(" ")} ${engineName(v.engine)}`.toLowerCase().includes(q)));
  // Native voices first, then multilingual ones, then models that still need downloading.
  const rank = (v) => (v.installed ? 0 : 2) + (v.lang === "*" ? 1 : 0);
  list.sort((a, b) => rank(a) - rank(b));
  const box = $("#voices");
  box.innerHTML = "";
  $("#voiceCount").textContent = list.length > MAX_CARDS
    ? `Hiển thị ${MAX_CARDS}/${list.length} giọng — gõ tìm kiếm để thu hẹp` : `${list.length} giọng`;
  if (!list.length) { box.innerHTML = `<div class="empty">Không có giọng phù hợp bộ lọc</div>`; return; }
  const picked = new Set(state.cast.map(voiceKey));
  for (const v of list.slice(0, MAX_CARDS)) {
    const isPicked = picked.has(voiceKey(v));
    const el = document.createElement("div");
    el.className = `voice ${isPicked ? "picked" : ""} ${v.installed ? "" : "missing"}`;
    const g = v.gender === "female" ? "♀" : v.gender === "male" ? "♂" : "◆";
    const actions = v.installed
      ? `<button class="play">▶ Nghe</button><button class="add">${isPicked ? "✓ Đã chọn" : "＋ Chọn"}</button>`
      : `<button class="dl-btn">⬇ Tải${v.size_mb ? ` ${Math.round(v.size_mb)}MB` : ""}</button>`;
    el.innerHTML = `
      <div class="voice-head">
        <div class="avatar" style="background:${colorFor(v.id)}">${g}</div>
        <div style="min-width:0">
          <div class="voice-name" title="${esc(v.id)}">${esc(v.name)}</div>
          <div class="voice-lang">${esc(v.lang === "*" ? "Đa ngôn ngữ" : v.lang)}${state.tab === "all" ? " · " + esc(engineName(v.engine)) : ""}</div>
        </div>
      </div>
      <div class="voice-tags">${v.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      <div class="voice-actions">${actions}</div>`;
    $(".play", el)?.addEventListener("click", (e) => previewVoice(v, null, e.currentTarget));
    $(".add", el)?.addEventListener("click", () => toggleCast(v));
    $(".dl-btn", el)?.addEventListener("click", (e) => downloadVoice(v, e.currentTarget));
    box.appendChild(el);
  }
}

async function downloadVoice(v, btn) {
  btn.disabled = true;
  btn.textContent = "⏳ Đang tải...";
  try {
    const res = await api(`/api/voices/${v.engine}/download`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: v.id }),
    });
    state.voices[v.engine] = await res.json();
    state.voiceLoads[v.engine] = Promise.resolve(state.voices[v.engine]);
    toast(`✅ Đã tải giọng ${v.name}`);
    renderTabs();
    renderVoices();
  } catch (e) {
    toast(`❌ ${e.message}`, 6000);
    btn.disabled = false;
    btn.textContent = "⬇ Thử lại";
  }
}

function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function toggleCast(v) {
  const k = state.cast.findIndex((c) => voiceKey(c) === voiceKey(v));
  if (k >= 0) removeCast(k);
  else {
    state.cast.push({ engine: v.engine, id: v.id, name: v.name, lang: v.lang, gender: v.gender, color: COLORS[state.cast.length % COLORS.length] });
    toast(`Đã thêm giọng ${v.name}`);
  }
  castChanged();
}

function removeCast(k) {
  state.cast.splice(k, 1);
  state.cast.forEach((c, i) => { c.color = COLORS[i % COLORS.length]; });
  for (const s of state.segments) {
    if (s.cast === k) s.cast = null;
    else if (s.cast > k) s.cast -= 1;
  }
}

function castChanged() {
  renderCast();
  renderVoices();
  renderSegments();
  saveSettings();
  updateHint();
}

/* Drop saved cast entries whose engine is no longer installed. */
function syncCast() {
  const before = state.cast.length;
  state.cast = state.cast.filter((c) => engineOk(c.engine));
  if (state.cast.length !== before) toast("Một số giọng đã lưu không còn khả dụng và đã được bỏ ra");
  castChanged();
}

function renderCast() {
  const box = $("#cast");
  box.innerHTML = "";
  if (!state.cast.length) { box.innerHTML = `<div class="cast-empty">Chưa chọn giọng nào — thử một mục ở <b>Gợi ý nhanh</b> phía trên</div>`; return; }
  state.cast.forEach((c, k) => {
    const el = document.createElement("div");
    el.className = `chip ${k === 0 ? "first" : ""}`;
    el.innerHTML = `<div class="avatar" style="background:${c.color}">${k + 1}</div>
      <div>${esc(c.name)} <small>${esc(engineName(c.engine))}</small></div>
      <button title="Nghe thử">▶</button><button title="Bỏ chọn">✕</button>`;
    const [play, del] = $$("button", el);
    play.addEventListener("click", (e) => previewVoice(c, null, e.currentTarget));
    del.addEventListener("click", () => { removeCast(k); castChanged(); });
    box.appendChild(el);
  });
}

/* Ready-made casts. Vietnamese gets curated styles; other languages get a female/male pair. */
function quickPicks() {
  const lang = targetLang();
  const edge = state.voices.edge || [];
  const picks = [];
  const has = (engine, id) => (state.voices[engine] || []).some((v) => v.id === id && v.installed);
  const add = (icon, label, sub, ids, mode = "single") => {
    const voices = ids.filter(([e, id]) => has(e, id));
    if (voices.length === ids.length) picks.push({ icon, label, sub, ids, mode });
  };
  if (lang === "vi") {
    const my = "vi-VN-HoaiMyNeural", nm = "vi-VN-NamMinhNeural";
    add("👩", "Nữ chuẩn", "HoaiMy · Edge", [["edge", my]]);
    add("👨", "Nam chuẩn", "NamMinh · Edge", [["edge", nm]]);
    add("👫", "Hội thoại nam – nữ", "HoaiMy + NamMinh, luân phiên", [["edge", my], ["edge", nm]], "rotate");
    add("📖", "Kể chuyện", "HoaiMy chậm, trầm", [["edge", `${my}|-10%|-4Hz`]]);
    add("📰", "Đọc tin tức", "NamMinh rõ ràng", [["edge", `${nm}|+8%|+0Hz`]]);
    add("🎉", "Quảng cáo", "HoaiMy nhanh, tươi", [["edge", `${my}|+18%|+10Hz`]]);
    add("🗺", "Bắc – Trung – Nam", "FPT.AI · 3 vùng miền", [["fpt", "banmai"], ["fpt", "myan"], ["fpt", "lannhi"]], "rotate");
    add("🌏", "Giọng Tây nói Việt", "Ava + Andrew · đa ngữ", [["edge", "en-US-AvaMultilingualNeural"], ["edge", "en-US-AndrewMultilingualNeural"]], "rotate");
    add("💻", "Offline", "Piper vais1000", [["piper", "vi_VN-vais1000-medium"]]);
  } else {
    const native = edge.filter((v) => base(v.lang) === lang);
    const f = native.find((v) => v.gender === "female"), m = native.find((v) => v.gender === "male");
    if (f) add("👩", "Giọng nữ", `${f.name} · Edge`, [["edge", f.id]]);
    if (m) add("👨", "Giọng nam", `${m.name} · Edge`, [["edge", m.id]]);
    if (f && m) add("👫", "Hội thoại", `${f.name} + ${m.name}`, [["edge", f.id], ["edge", m.id]], "rotate");
  }
  return picks;
}

function renderQuick() {
  const picks = quickPicks();
  $("#quickWrap").classList.toggle("hidden", !picks.length);
  const row = $("#quick");
  row.innerHTML = "";
  for (const p of picks) {
    const b = document.createElement("button");
    b.className = "qp";
    b.innerHTML = `<b>${p.icon} ${esc(p.label)}</b><span>${esc(p.sub)}</span>`;
    b.addEventListener("click", () => {
      state.cast = p.ids.map(([engine, id], k) => {
        const v = state.voices[engine].find((x) => x.id === id);
        return { engine, id, name: v.name, lang: v.lang, gender: v.gender, color: COLORS[k % COLORS.length] };
      });
      state.segments.forEach((s) => { s.cast = null; });
      $(`input[name=mode][value=${p.mode}]`).checked = true;
      castChanged();
      toast(`🎭 Đã chọn: ${p.label}`);
    });
    row.appendChild(b);
  }
}

async function previewVoice(v, text, btn) {
  const wasPlaying = state.playingBtn === btn;
  stopPreview();
  if (wasPlaying) return;  // second click stops
  const lang = v.lang === "*" ? targetLang() : base(v.lang);
  text = (text || "").trim() || SAMPLE[lang] || SAMPLE.en;
  const old = btn?.textContent;
  if (btn) { btn.textContent = "⏳"; btn.disabled = true; }
  try {
    const res = await api("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: v.engine, voice: v.id, text: text.slice(0, 300), lang }),
    });
    const audio = new Audio(URL.createObjectURL(await res.blob()));
    audio.playbackRate = +$("#speed").value;
    state.audio = audio;
    if (btn) {
      state.playingBtn = btn;
      btn.dataset.label = old;
      btn.textContent = "⏹";
      btn.classList.add("playing");
    }
    audio.addEventListener("ended", stopPreview);
    await audio.play();
  } catch (e) {
    toast(`❌ ${e.message}`, 5000);
    if (btn) btn.textContent = old;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function stopPreview() {
  state.audio?.pause();
  state.audio = null;
  const b = state.playingBtn;
  if (b) { b.textContent = b.dataset.label || "▶ Nghe"; b.classList.remove("playing"); }
  state.playingBtn = null;
}

function initVoices() {
  $("#voiceSearch").addEventListener("input", renderVoices);
  $("#voiceLang").addEventListener("change", () => { $("#voiceLang").dataset.want = $("#voiceLang").value; renderVoices(); renderTabs(); });
  $$("#genderFilter button").forEach((b) => b.addEventListener("click", () => {
    state.gender = b.dataset.g;
    $$("#genderFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderVoices();
  }));
  $$("input[name=mode]").forEach((r) => r.addEventListener("change", () => { renderSegments(); saveSettings(); }));
}

/* ------------------------------------------------------------------ step 4: export */
function initExport() {
  const bind = (id, out, f) => {
    const upd = () => { $(out).textContent = f(+$(id).value); };
    $(id).addEventListener("input", upd);
    upd();
  };
  bind("#speed", "#speedOut", (v) => `${v.toFixed(2)}×`);
  bind("#voiceVol", "#voiceVolOut", (v) => `${Math.round(v * 100)}%`);
  bind("#origVol", "#origVolOut", (v) => `${Math.round(v * 100)}%`);
  const syncVis = () => {
    $("#origVolWrap").classList.toggle("hidden", !$("#keepOrig").checked);
    $("#burnOpts").classList.toggle("hidden", subMode() !== "burn");
  };
  $("#keepOrig").addEventListener("change", syncVis);
  $$("input[name=subMode]").forEach((r) => r.addEventListener("change", syncVis));
  syncVis();
  for (const id of SAVED_INPUTS) $(`#${id}`).addEventListener("change", () => { saveSettings(); renderSummary(); });
  $$("input[name=subMode]").forEach((r) => r.addEventListener("change", saveSettings));
  ["#subSize", "#subColor", "#subBox", "#bilingual"].forEach((s) => $(s).addEventListener("input", updateOverlay));
  $("#btnRender").addEventListener("click", startRender);
}

function renderSummary() {
  const box = $("#summary");
  if (!state.segments.length) { box.innerHTML = ""; return; }
  const segs = state.segments.filter((s) => s.text.trim());
  const used = new Set(segs.map((_, i) => resolveVoice(state.segments.indexOf(segs[i]))).filter(Boolean).map(voiceKey));
  const fast = segs.filter((s) => s.text.length / Math.max(s.end - s.start, 0.1) > FAST_CPS).length;
  const chars = segs.reduce((n, s) => n + s.text.length, 0);
  const bits = [`💬 ${segs.length} câu`, `🔤 ${chars.toLocaleString("vi")} ký tự`, `🎭 ${used.size || 0} giọng`];
  let html = bits.map((b) => `<span>${b}</span>`).join("");
  if (fast) html += `<span class="warn" title="Các câu này sẽ được đọc nhanh hơn để khớp thời gian">⚡ ${fast} câu dài</span>`;
  if (!state.cast.length) html += `<span class="warn">⚠ Chưa chọn giọng</span>`;
  box.innerHTML = html;
}

async function startRender() {
  if (!state.job) return toast("Hãy tải video lên trước");
  if (!state.cast.length) {
    $("#step3").scrollIntoView();
    return toast("Hãy chọn ít nhất một giọng đọc ở bước 3");
  }
  const segments = state.segments
    .map((s, i) => ({ s, v: resolveVoice(i) }))
    .filter(({ s }) => s.text.trim())
    .map(({ s, v }) => ({
      start: s.start, end: Math.max(s.end, s.start + 0.2), text: s.text, original: s.original || null,
      engine: v.engine, voice: v.id,
    }));
  if (!segments.length) return toast("Không có câu phụ đề nào để đọc");

  const burn = subMode() === "burn";
  const body = {
    segments,
    speed: +$("#speed").value,
    max_speedup: $("#autoFit").checked ? 1.6 : 1.0,
    keep_original: $("#keepOrig").checked,
    original_volume: +$("#origVol").value,
    voice_volume: +$("#voiceVol").value,
    burn_subtitles: burn,
    bilingual: $("#bilingual").checked,
    style: { size: +$("#subSize").value, color: $("#subColor").value, box: $("#subBox").checked },
  };

  const btn = $("#btnRender");
  const prog = $("#prog2");
  btn.disabled = true;
  $("#downloads").classList.add("hidden");
  setStep(4);
  setProgress(prog, 0, "Đang bắt đầu...");
  try {
    await api(`/api/jobs/${state.job.id}/render`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const job = await poll(state.job.id, (j) => setProgress(prog, j.progress, j.message || "Đang xử lý..."), ["done"]);
    state.job = job;
    setProgress(prog, 1, `🎉 ${job.message}`, "ok");
    const f = (n) => `/api/jobs/${job.id}/files/${n}`;
    $("#dlVideo").href = f(job.outputs.video);
    $("#dlSrt").href = f(job.outputs.srt);
    $("#dlVoice").href = f(job.outputs.voice);
    $("#downloads").classList.remove("hidden");
    state.resultUrl = `${f(job.outputs.video)}?t=${Date.now()}`;
    state.resultBurned = burn;
    $("#srcToggle").classList.remove("hidden");
    setSource("result");
    $$(".step").forEach((s) => s.classList.add("done"));
    updateHint();
    toast("🎉 Video lồng tiếng đã sẵn sàng!");
  } catch (e) {
    setProgress(prog, 1, `❌ ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ boot */
$$(".step").forEach((b) => b.addEventListener("click", () => $(`#step${b.dataset.step}`).scrollIntoView()));
initUpload();
loadSettings();
initPlayer();
initKeyboard();
initSegments();
initVoices();
initExport();
renderCast();
setStep(1);
updateHint();
loadEngines().catch((e) => toast(`Không kết nối được máy chủ: ${e.message}`, 6000));
