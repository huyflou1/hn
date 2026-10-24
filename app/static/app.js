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

const state = {
  file: null,
  job: null,
  segments: [],
  engines: [],
  engine: null,
  voices: {},          // engine id -> Voice[]
  cast: [],            // [{engine, id, name, lang, gender}]
  gender: "",
  audio: null,
};

const base = (code) => (code || "").replace("_", "-").split("-")[0].toLowerCase();
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
};
const parseTime = (str) => {
  const parts = String(str).split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

function setStep(n) {
  $$(".step").forEach((el) => {
    const s = +el.dataset.step;
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  for (let i = 2; i <= 4; i++) $(`#step${i}`).classList.toggle("locked", n < 2);
}

function setProgress(el, p, text, err = false) {
  el.classList.remove("hidden");
  el.classList.toggle("err", err);
  $(".bar", el).style.width = `${Math.round(p * 100)}%`;
  $("span", el).textContent = text;
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
}

function pickFile(file) {
  state.file = file;
  $("#dzFile").textContent = `📹 ${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  $("#btnTranscribe").disabled = false;
  showVideo(URL.createObjectURL(file));
}

function showVideo(src) {
  $("#player").innerHTML = "";
  const v = document.createElement("video");
  v.controls = true;
  v.src = src;
  v.addEventListener("timeupdate", () => highlightSegment(v.currentTime));
  $("#player").appendChild(v);
  state.video = v;
  refreshTrack();
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
    setProgress(prog, 1, `✅ ${done.message}`);
    if (done.warning) toast(`⚠ ${done.warning}`, 8000);
    renderMeta();
    renderSegments();
    setStep(2);
    $$("#step2, #step3, #step4").forEach((s) => s.classList.remove("locked"));
    selectDefaultVoiceLang();
    $("#step2").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setProgress(prog, 1, `❌ ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
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
  const name = (code) => (LANGS.find(([c]) => c === base(code)) || [, code])[1];
  const bits = [`⏱ ${fmt(j.duration)}`, `💬 ${state.segments.length} câu`];
  if (j.source_language) bits.push(`🗣 ${name(j.source_language)}`);
  if (j.language && base(j.language) !== base(j.source_language)) bits.push(`🌐 → ${name(j.language)}`);
  $("#meta").innerHTML = bits.map((b) => `<span>${esc(b)}</span>`).join("");
}

/* ------------------------------------------------------------------ step 2: segments */
function renderSegments() {
  const q = $("#segSearch").value.trim().toLowerCase();
  const box = $("#segments");
  box.innerHTML = "";
  $("#segCount").textContent = `${state.segments.length} câu`;
  state.segments.forEach((seg, i) => {
    if (q && !seg.text.toLowerCase().includes(q)) return;
    const el = document.createElement("div");
    el.className = "seg";
    el.dataset.i = i;
    const voice = resolveVoice(i);
    el.innerHTML = `
      <div class="seg-time">
        <button title="Phát đoạn này">▶ ${fmt(seg.start)}</button>
        <input value="${fmt(seg.start)}" data-k="start" title="Bắt đầu">
        <input value="${fmt(seg.end)}" data-k="end" title="Kết thúc">
      </div>
      <div class="seg-body">
        <textarea rows="2">${esc(seg.text)}</textarea>
        ${seg.original ? `<div class="seg-orig">${esc(seg.original)}</div>` : ""}
        <div class="seg-foot">
          <span class="voice-dot" style="background:${voice ? voice.color : "#fff"}"></span>
          <select title="Giọng đọc cho câu này">${castOptions(seg.cast)}</select>
          <button class="icon" data-act="listen" title="Nghe thử câu này">🔊</button>
          <button class="icon" data-act="split" title="Thêm câu sau">＋</button>
          <button class="icon del" data-act="del" title="Xoá câu">✕</button>
        </div>
      </div>`;
    $("textarea", el).addEventListener("input", (e) => { seg.text = e.target.value; refreshTrackSoon(); });
    $$(".seg-time input", el).forEach((inp) => inp.addEventListener("change", () => {
      const v = parseTime(inp.value);
      if (!Number.isNaN(v)) seg[inp.dataset.k] = v;
      inp.value = fmt(seg[inp.dataset.k]);
      refreshTrackSoon();
    }));
    $(".seg-time button", el).addEventListener("click", () => playAt(seg.start));
    $("select", el).addEventListener("change", (e) => {
      seg.cast = e.target.value === "" ? null : +e.target.value;
      if (seg.cast !== null) $$('input[name=mode]').find((r) => r.value === "manual").checked = true;
      renderSegments();
    });
    $("[data-act=listen]", el).addEventListener("click", (e) => {
      const v = resolveVoice(i);
      if (!v) return toast("Hãy chọn ít nhất một giọng ở bước 3");
      previewVoice(v, seg.text, e.currentTarget);
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
      refreshTrackSoon();
    });
    box.appendChild(el);
  });
  if (!box.children.length) box.innerHTML = `<div class="empty">Không có câu nào</div>`;
  refreshTrackSoon();
}

function castOptions(selected) {
  const auto = `<option value="">🤖 Tự động${state.cast.length ? "" : " (chưa có giọng)"}</option>`;
  return auto + state.cast.map((c, k) =>
    `<option value="${k}" ${selected === k ? "selected" : ""}>${esc(c.name)} · ${esc(engineName(c.engine))}</option>`).join("");
}

function resolveVoice(i) {
  if (!state.cast.length) return null;
  const seg = state.segments[i];
  if (seg.cast !== null && seg.cast !== undefined && state.cast[seg.cast]) return state.cast[seg.cast];
  const mode = $("input[name=mode]:checked").value;
  if (mode === "rotate") return state.cast[i % state.cast.length];
  return state.cast[0];
}

function playAt(t) {
  if (!state.video) return;
  state.video.currentTime = t;
  state.video.play();
}

function highlightSegment(t) {
  $$(".seg").forEach((el) => {
    const s = state.segments[+el.dataset.i];
    el.classList.toggle("playing", !!s && t >= s.start && t <= s.end);
  });
}

/* Live subtitle track on the preview player, rebuilt from the editable segments. */
function refreshTrack() {
  const v = state.video;
  if (!v) return;
  $$("track", v).forEach((t) => t.remove());
  if (!state.segments.length) return;
  const ts = (t) => new Date(Math.max(0, t) * 1000).toISOString().substr(11, 12);
  const vtt = "WEBVTT\n\n" + state.segments.map((s) => `${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join("\n");
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "Phụ đề";
  track.default = true;
  track.src = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  v.appendChild(track);
  track.addEventListener("load", () => { track.track.mode = "showing"; });
}
let trackTimer;
function refreshTrackSoon() { clearTimeout(trackTimer); trackTimer = setTimeout(refreshTrack, 500); }

function initSegments() {
  $("#segSearch").addEventListener("input", renderSegments);
  $("#btnAddSeg").addEventListener("click", () => {
    const last = state.segments.at(-1);
    const start = last ? last.end : 0;
    state.segments.push({ start, end: start + 2, text: "", cast: null });
    renderSegments();
    $(".seg:last-child textarea")?.focus();
  });
}

/* ------------------------------------------------------------------ step 3: voices */
const engineName = (id) => state.engines.find((e) => e.id === id)?.name || id;

async function loadEngines() {
  state.engines = await (await api("/api/engines")).json();
  const box = $("#engines");
  box.innerHTML = "";
  for (const e of state.engines) {
    const b = document.createElement("button");
    b.className = `engine ${e.available ? "" : "off"}`;
    b.dataset.id = e.id;
    b.innerHTML = `
      <span class="badge">${e.available ? (e.needs_network ? "online" : "offline") : "chưa cài"}</span>
      <b>${esc(e.name)}</b>
      <span class="repo">github.com/${esc(e.repo)}</span>
      <div class="desc">${esc(e.description)}</div>`;
    b.title = e.available ? "" : `Cài đặt: ${e.install_hint}`;
    b.addEventListener("click", () => {
      if (!e.available) return toast(`Chưa cài ${e.name}. Chạy: ${e.install_hint}`, 6000);
      selectEngine(e.id);
    });
    box.appendChild(b);
  }
  const first = state.engines.find((e) => e.available);
  if (first) selectEngine(first.id);
}

async function selectEngine(id) {
  state.engine = id;
  $$(".engine").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  if (!state.voices[id]) {
    $("#voices").innerHTML = `<div class="empty">⏳ Đang tải danh sách giọng...</div>`;
    try {
      state.voices[id] = await (await api(`/api/voices/${id}`)).json();
    } catch (e) {
      $("#voices").innerHTML = `<div class="empty">❌ ${esc(e.message)}</div>`;
      return;
    }
  }
  fillLangFilter();
  renderVoices();
}

function fillLangFilter() {
  const sel = $("#voiceLang");
  const want = sel.value || sel.dataset.want || "";
  const langs = new Map();
  for (const v of state.voices[state.engine] || []) {
    const b = v.lang === "*" ? "*" : base(v.lang);
    langs.set(b, (langs.get(b) || 0) + 1);
  }
  sel.innerHTML = "";
  sel.add(new Option(`🌍 Mọi ngôn ngữ`, ""));
  const nameOf = (c) => c === "*" ? "Đa ngôn ngữ" : (LANGS.find(([k]) => k === c)?.[1] || c);
  [...langs.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))
    .forEach(([c, n]) => sel.add(new Option(`${nameOf(c)} (${n})`, c)));
  sel.value = langs.has(want) ? want : (langs.has("*") ? "" : "");
}

function selectDefaultVoiceLang() {
  const lang = base(state.job?.language);
  $("#voiceLang").dataset.want = lang;
  $("#voiceLang").value = "";
  if (state.engine) { fillLangFilter(); renderVoices(); }
}

function renderVoices() {
  const q = $("#voiceSearch").value.trim().toLowerCase();
  const lang = $("#voiceLang").value;
  const list = (state.voices[state.engine] || []).filter((v) =>
    (!lang || base(v.lang) === lang || (lang === "*" && v.lang === "*")) &&
    (!state.gender || v.gender === state.gender) &&
    (!q || `${v.name} ${v.id} ${v.lang} ${v.tags.join(" ")}`.toLowerCase().includes(q)));
  const box = $("#voices");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = `<div class="empty">Không có giọng phù hợp bộ lọc</div>`; return; }
  for (const v of list.slice(0, 300)) {
    const picked = state.cast.some((c) => c.engine === v.engine && c.id === v.id);
    const el = document.createElement("div");
    el.className = `voice ${picked ? "picked" : ""}`;
    const g = v.gender === "female" ? "♀" : v.gender === "male" ? "♂" : "◆";
    el.innerHTML = `
      <div class="voice-head">
        <div class="avatar" style="background:${colorFor(v.id)}">${g}</div>
        <div style="min-width:0">
          <div class="voice-name" title="${esc(v.id)}">${esc(v.name)}</div>
          <div class="voice-lang">${esc(v.lang === "*" ? "Đa ngôn ngữ" : v.lang)}</div>
        </div>
      </div>
      <div class="voice-tags">${v.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      <div class="voice-actions">
        <button class="play">▶ Nghe</button>
        <button class="add">${picked ? "✓ Đã chọn" : "＋ Chọn"}</button>
      </div>`;
    $(".play", el).addEventListener("click", (e) => previewVoice(v, null, e.currentTarget));
    $(".add", el).addEventListener("click", () => toggleCast(v));
    box.appendChild(el);
  }
}

function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function toggleCast(v) {
  const k = state.cast.findIndex((c) => c.engine === v.engine && c.id === v.id);
  if (k >= 0) removeCast(k);
  else {
    state.cast.push({ ...v, color: COLORS[state.cast.length % COLORS.length] });
    toast(`Đã thêm giọng ${v.name}`);
  }
  renderCast();
  renderVoices();
  renderSegments();
}

function removeCast(k) {
  state.cast.splice(k, 1);
  for (const s of state.segments) {
    if (s.cast === k) s.cast = null;
    else if (s.cast > k) s.cast -= 1;
  }
}

function renderCast() {
  const box = $("#cast");
  box.innerHTML = "";
  if (!state.cast.length) { box.innerHTML = `<div class="cast-empty">Chưa chọn giọng nào</div>`; return; }
  state.cast.forEach((c, k) => {
    const el = document.createElement("div");
    el.className = `chip ${k === 0 ? "first" : ""}`;
    el.innerHTML = `<div class="avatar" style="background:${c.color}">${k + 1}</div>
      <div>${esc(c.name)} <small>${esc(engineName(c.engine))}</small></div>
      <button title="Bỏ chọn">✕</button>`;
    $("button", el).addEventListener("click", () => { removeCast(k); renderCast(); renderVoices(); renderSegments(); });
    box.appendChild(el);
  });
}

async function previewVoice(v, text, btn) {
  if (state.audio) state.audio.pause();
  const lang = v.lang === "*" ? base(state.job?.language || "en") : base(v.lang);
  text = (text || "").trim() || SAMPLE[lang] || SAMPLE.en;
  const old = btn?.textContent;
  if (btn) { btn.textContent = "⏳"; btn.disabled = true; }
  try {
    const res = await api("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: v.engine, voice: v.id, text: text.slice(0, 300), lang }),
    });
    state.audio = new Audio(URL.createObjectURL(await res.blob()));
    state.audio.playbackRate = +$("#speed").value;
    await state.audio.play();
  } catch (e) {
    toast(`❌ ${e.message}`, 5000);
  } finally {
    if (btn) { btn.textContent = old; btn.disabled = false; }
  }
}

function initVoices() {
  $("#voiceSearch").addEventListener("input", renderVoices);
  $("#voiceLang").addEventListener("change", () => { $("#voiceLang").dataset.want = $("#voiceLang").value; renderVoices(); });
  $$("#genderFilter button").forEach((b) => b.addEventListener("click", () => {
    state.gender = b.dataset.g;
    $$("#genderFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderVoices();
  }));
  $$("input[name=mode]").forEach((r) => r.addEventListener("change", renderSegments));
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
  $("#keepOrig").addEventListener("change", (e) => $("#origVolWrap").classList.toggle("hidden", !e.target.checked));
  $$("input[name=subMode]").forEach((r) => r.addEventListener("change", () =>
    $("#burnOpts").classList.toggle("hidden", $("input[name=subMode]:checked").value !== "burn")));
  $("#btnRender").addEventListener("click", startRender);
}

async function startRender() {
  if (!state.job) return toast("Hãy tải video lên trước");
  if (!state.cast.length) {
    $("#step3").scrollIntoView({ behavior: "smooth" });
    return toast("Hãy chọn ít nhất một giọng đọc ở bước 3");
  }
  const segments = state.segments
    .map((s, i) => ({ s, v: resolveVoice(i) }))
    .filter(({ s }) => s.text.trim())
    .map(({ s, v }) => ({ start: s.start, end: Math.max(s.end, s.start + 0.2), text: s.text, engine: v.engine, voice: v.id }));
  if (!segments.length) return toast("Không có câu phụ đề nào để đọc");

  const body = {
    segments,
    speed: +$("#speed").value,
    max_speedup: $("#autoFit").checked ? 1.6 : 1.0,
    keep_original: $("#keepOrig").checked,
    original_volume: +$("#origVol").value,
    voice_volume: +$("#voiceVol").value,
    burn_subtitles: $("input[name=subMode]:checked").value === "burn",
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
    setProgress(prog, 1, `🎉 ${job.message}`);
    const f = (n) => `/api/jobs/${job.id}/files/${n}`;
    $("#dlVideo").href = f(job.outputs.video);
    $("#dlSrt").href = f(job.outputs.srt);
    $("#dlVoice").href = f(job.outputs.voice);
    $("#downloads").classList.remove("hidden");
    showVideo(`${f(job.outputs.video)}?t=${Date.now()}`);
    $$(".step").forEach((s) => s.classList.add("done"));
    toast("🎉 Video lồng tiếng đã sẵn sàng!");
  } catch (e) {
    setProgress(prog, 1, `❌ ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ boot */
initUpload();
initSegments();
initVoices();
initExport();
setStep(1);
loadEngines().catch((e) => toast(`Không kết nối được máy chủ: ${e.message}`, 6000));
