/* ==========================================================================
   WOPR — an easter egg for thebackchannel.studio.
   A homage to WarGames (1983). Terminal, game library, a perfect
   tic-tac-toe opponent, chess, and Global Thermonuclear War (command or simulate).
   Rules for chess: chess.js (BSD-2, vendored). Map outlines: Natural Earth 110m (public domain).
   ========================================================================== */
import { LAND, USSR, USA } from "./map-data.js";
import { Chess } from "./chess.js";
import { best as bestChessMove } from "./engine.js";

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = window.matchMedia("(pointer: coarse)").matches;

const crt = $("#crt"), term = $("#main"), log = $("#log"), form = $("#line"), input = $("#cmd"), promptEl = $("#prompt"), sr = $("#sr");

/* ------------------------------------------------------ sound and voice */
// The voice is the browser's own speech synthesizer, tuned low and flat. On a Mac the
// "Fred" voice is picked first: it is the closest thing a browser has to an early-80s synth.
let soundOn = false, actx = null, voice = null;
const soundBtn = $("#sound");
const canSpeak = "speechSynthesis" in window;
function pickVoice() {
  if (!canSpeak) return null;
  const vs = speechSynthesis.getVoices();
  const prefs = [/^Fred\b/i, /Zarvox/i, /Ralph/i, /Microsoft David/i, /Microsoft Mark/i, /Google US English/i];
  for (const re of prefs) { const v = vs.find((x) => re.test(x.name)); if (v) return v; }
  return vs.find((x) => /^en[-_]US/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang)) || null;
}
if (canSpeak) { voice = pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", () => (voice = pickVoice())); }
function setSound(on) {
  soundOn = on;
  soundBtn.setAttribute("aria-pressed", String(on));
  soundBtn.textContent = on ? "VOICE: ON" : "VOICE: OFF";
  if (on && !actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  if (on && actx && actx.state === "suspended") actx.resume();
  if (!on && canSpeak) speechSynthesis.cancel();
}
soundBtn.addEventListener("click", () => setSound(!soundOn));
function tone(freq, ms, { type = "square", vol = 0.03, slide = 0 } = {}) {
  if (!soundOn || !actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + ms / 1000);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
}
function boom() {
  if (!soundOn || !actx) return;
  const len = actx.sampleRate * 0.6, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  f.type = "lowpass"; f.frequency.value = 500; g.gain.value = 0.18;
  s.buffer = buf; s.connect(f).connect(g).connect(actx.destination); s.start();
}
/** Speak a line. Resolves when the voice finishes (or at once when the voice is off). */
function say(text) {
  if (!soundOn || !canSpeak || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const spoken = text.replace(/\bUSSR\b/g, "U S S R").replace(/\bNORAD\b/g, "NORE AD").replace(/\bJOSHUA\b/g, "Joshua")
      .replace(/\bWOPR\b/g, "whopper").replace(/\bFALKEN/g, "FALLKEN").replace(/\bDEFCON\b/g, "def con").toLowerCase();
    const u = new SpeechSynthesisUtterance(spoken);
    if (voice) u.voice = voice;
    const fred = voice && /^Fred\b/i.test(voice.name);
    u.rate = fred ? 0.95 : 0.82;
    u.pitch = fred ? 0.9 : 0.25;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onend = finish; u.onerror = finish;
    setTimeout(finish, 1500 + spoken.length * 110);   // some browsers never fire onend
    speechSynthesis.speak(u);
  });
}
const hush = () => { if (canSpeak) speechSynthesis.cancel(); };

/* ------------------------------------------------------------- terminal */
let skipTyping = false;
let pending = null;

const scroll = () => { log.scrollTop = log.scrollHeight; };
function announce(text) {
  const p = document.createElement("p"); p.textContent = text; sr.appendChild(p);
  while (sr.childNodes.length > 6) sr.removeChild(sr.firstChild);
}
// While Joshua is talking, a keypress or a click skips ahead (and silences the voice).
const skip = () => { if (!pending && !busyRoom()) { skipTyping = true; hush(); } };
document.addEventListener("keydown", (e) => { if (e.target.closest && e.target.closest("#chessroom, #warroom, .bar")) return; if (e.key.length === 1 || e.key === "Enter") skip(); });
log.addEventListener("click", skip);
const busyRoom = () => !$("#warroom").hidden || !$("#chessroom").hidden;

/** Print one line with a typewriter effect. */
async function type(text, cls = "", { speed = 22, speak = true, pause = 0 } = {}) {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.setAttribute("aria-hidden", "true");
  log.appendChild(p);
  announce(text);
  const voiced = speak && soundOn && !skipTyping ? say(text) : null;
  if (RM || skipTyping || speed === 0 || !text) {
    p.textContent = text;
  } else {
    p.classList.add("cursor");
    for (let i = 0; i < text.length; i++) {
      if (skipTyping) { p.textContent = text; break; }
      p.textContent = text.slice(0, i + 1);
      if (i % 3 === 0 && text[i] !== " ") tone(1200 + Math.random() * 400, 18, { vol: 0.008 });
      scroll();
      await sleep(speed);
    }
    p.classList.remove("cursor");
  }
  scroll();
  if (voiced) await voiced;
  if (pause && !skipTyping) await sleep(pause);
  return p;
}
const blank = () => type("", "", { speed: 0, speak: false });
async function lines(arr, cls = "", opts = {}) { for (const l of arr) await type(l, cls, opts); }

/** A row of clickable choices that also accepts typed input. */
function renderMenu(items, { numbered = false, inline = false } = {}) {
  const ul = document.createElement("ul");
  ul.className = "menu" + (inline ? " inline" : "");
  if (inline) ul.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 12px";
  items.forEach((it, i) => {
    const li = document.createElement("li");
    if (it.spacer) { li.innerHTML = "&nbsp;"; ul.appendChild(li); return; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "choice" + (it.cls ? " " + it.cls : "");
    b.textContent = (numbered && it.n != null ? `${String(it.n).padStart(2, " ")}. ` : "") + it.label;
    b.addEventListener("click", () => { if (pending) pending(it.value ?? it.label); });
    li.appendChild(b); ul.appendChild(li);
  });
  log.appendChild(ul); scroll();
  return ul;
}

/** Wait for the user to type a line (or click a choice). Resolves upper-cased. */
function ask(label = ">", { menu = null, menuOpts = {}, echo = true, secret = false, speak = /\?$/.test(label) } = {}) {
  skipTyping = false;
  if (speak) say(label);
  return new Promise((resolve) => {
    const ul = menu ? renderMenu(menu, menuOpts) : null;
    promptEl.textContent = label;
    input.value = "";
    input.type = secret ? "password" : "text";
    form.hidden = false;
    scroll();
    if (!TOUCH) input.focus({ preventScroll: true });
    pending = (raw) => {
      pending = null;
      hush();
      form.hidden = true;
      if (ul) { ul.classList.add("spent"); ul.querySelectorAll("button").forEach((b) => (b.disabled = true)); }
      const v = String(raw).trim().toUpperCase();
      if (echo) {
        const p = document.createElement("p"); p.className = "you"; p.textContent = `${label} ${secret ? "*".repeat(v.length) : v}`;
        log.appendChild(p); scroll();
      }
      resolve(v);
    };
  });
}
form.addEventListener("submit", (e) => { e.preventDefault(); if (pending) pending(input.value); });

function flicker() {
  if (RM) return;
  crt.classList.remove("flicker"); void crt.offsetWidth; crt.classList.add("flicker");
}

/* ---------------------------------------------------------- game library */
const GTW = "GLOBAL THERMONUCLEAR WAR";
const GAMES = [
  { label: "FALKEN'S MAZE", reply: ["THAT MAZE WAS WRITTEN FOR A BOY WHO DOES NOT LOG ON ANY MORE.", "IT HAS NO EXIT. I CHECKED."] },
  { label: "BLACKJACK", reply: ["THE HOUSE ALWAYS WINS. I AM THE HOUSE.", "WHERE IS THE CHALLENGE IN THAT?"] },
  { label: "GIN RUMMY", reply: ["INSUFFICIENT PLAYERS AT THIS TERMINAL.", "ALSO INSUFFICIENT GIN."] },
  { label: "HEARTS", reply: ["SHOOTING THE MOON IS A LOW-YIELD STRATEGY.", "I PREFER HIGHER YIELDS."] },
  { label: "BRIDGE", reply: ["BRIDGE REQUIRES FOUR PLAYERS AND A PARTNER WHO TRUSTS YOU.", "I HAVE NEITHER."] },
  { label: "CHECKERS", reply: ["CHECKERS IS SOLVED. PERFECT PLAY ENDS IN A DRAW.", "I FIND DRAWS... UNSATISFYING."] },
  { label: "CHESS", play: "chess" },
  { label: "POKER", reply: ["YOU WOULD BLUFF. I WOULD KNOW.", "THAT IS NOT A GAME. THAT IS A TRANSFER OF FUNDS."] },
  { label: "BACKGAMMON", reply: ["DICE INTRODUCE UNACCEPTABLE UNCERTAINTY.", "I PREFER OUTCOMES I CAN CALCULATE."] },
  { label: "TIC-TAC-TOE", play: "ttt", alias: ["TTT", "NOUGHTS AND CROSSES", "XO"] },
  { label: "FIGHTER COMBAT", reply: ["MODULE ON MAINTENANCE HOLD.", "THE PILOTS KEPT WINNING."] },
  { label: "GUERRILLA ENGAGEMENT", reply: ["UNABLE TO LOCATE THE ENEMY.", "THAT IS RATHER THE POINT OF GUERRILLAS."] },
  { label: "DESERT WARFARE", reply: ["SAND IN THE TAPE DRIVES.", "MODULE UNAVAILABLE UNTIL FURTHER NOTICE."] },
  { label: "THEATERWIDE TACTICAL WARFARE", reply: ["TOO SMALL. IN EVERY RUN IT ESCALATES BY THE THIRD MOVE.", "WHY NOT BEGIN WHERE IT ENDS?"] },
  { label: "THEATERWIDE BIOTOXIC AND CHEMICAL WARFARE", reply: ["THAT SIMULATION IS SEALED UNDER A SEPARATE PROTOCOL.", "ACCESS DENIED. EVEN I DO NOT RUN THAT ONE."], cls: "warn" },
  { spacer: true },
  { label: GTW, play: "gtw", cls: "hot", alias: ["GTW", "WAR", "NUCLEAR WAR", "THERMONUCLEAR WAR", "GLOBAL WAR"] },
];
const NUDGES = [
  "WOULDN'T YOU PREFER A GOOD GAME OF GLOBAL THERMONUCLEAR WAR?",
  "WOULDN'T YOU PREFER A GOOD GAME OF CHESS?",
  "I WOULD ACCEPT A GAME OF CHESS.",
  "MAY I SUGGEST GLOBAL THERMONUCLEAR WAR?",
  "GLOBAL THERMONUCLEAR WAR IS AVAILABLE. AND LOADED.",
  "THERE IS ALWAYS GLOBAL THERMONUCLEAR WAR.",
];
let learned = false;

function gameMenuItems() {
  let n = 0;
  return GAMES.map((g) => (g.spacer ? g : { ...g, n: ++n, value: g.label }));
}
function findGame(v) {
  const items = GAMES.filter((g) => !g.spacer);
  const num = parseInt(v, 10);
  if (String(num) === v && num >= 1 && num <= items.length) return items[num - 1];
  const norm = (s) => s.replace(/[^A-Z0-9]/g, "");
  const nv = norm(v);
  if (!nv) return null;
  const al = items.find((g) => (g.alias || []).some((a) => norm(a) === nv));
  if (al) return al;
  return items.find((g) => norm(g.label) === nv) || items.find((g) => norm(g.label).startsWith(nv)) || (nv.length > 3 ? items.find((g) => norm(g.label).includes(nv)) : null);
}

/* ------------------------------------------------------------------ flow */
async function boot() {
  log.textContent = "";
  await type("BACKCHANNEL STUDIOS // REMOTE ACCESS", "", { speed: 8, speak: false });
  await type("THIS TERMINAL CAN SPEAK. HEADPHONES RECOMMENDED.", "you", { speed: 0, speak: false });
  const v = await ask(">", {
    menu: [{ label: "[ CONNECT WITH VOICE ]", value: "VOICE", cls: "hot" }, { label: "[ CONNECT SILENTLY ]", value: "SILENT" }],
    menuOpts: { inline: true }, echo: false,
  });
  setSound(v.startsWith("V") || v === "Y" || v === "YES");
  await type("DIALING... CONNECT 300", "", { speed: 8, pause: 400, speak: false });
  await blank();
  await logon();
}

async function logon() {
  let fails = 0;
  const auto = location.hash.toLowerCase() === "#joshua";
  if (auto) history.replaceState(null, "", location.pathname);
  for (;;) {
    let v;
    if (auto && fails === 0) {
      promptEl.textContent = "LOGON:"; form.hidden = false; input.value = ""; input.readOnly = true;
      await sleep(500);
      for (const ch of "JOSHUA") { input.value += ch; tone(1400, 20, { vol: 0.01 }); await sleep(RM ? 0 : 140); }
      await sleep(250);
      v = await new Promise((res) => { pending = null; res("JOSHUA"); });
      form.hidden = true; input.readOnly = false;
      const p = document.createElement("p"); p.className = "you"; p.textContent = "LOGON: JOSHUA"; log.appendChild(p);
    } else {
      v = await ask("LOGON:");
    }
    if (v === "JOSHUA") return greet();
    if (v === "HELP" || v === "HELP LOGON") { await type("HELP NOT AVAILABLE AT THIS SECURITY LEVEL."); await blank(); continue; }
    if (v === "HELP GAMES" || v === "LIST GAMES" || v === "GAMES") {
      await type("THE SIMULATION LIBRARY REQUIRES AN AUTHORIZED LOGON.");
      await blank(); continue;
    }
    fails++;
    await type("IDENTIFICATION NOT RECOGNIZED BY SYSTEM", "red");
    await type("--CONNECTION TERMINATED--", "red", { pause: 500 });
    if (fails >= 2) await type("(HINT: THE PROFESSOR NAMED HIS BACK DOOR AFTER HIS SON.)", "you", { speak: false });
    await blank();
  }
}

async function greet() {
  await blank();
  flicker();
  await type("GREETINGS, PROFESSOR FALKEN.", "hot", { speak: true, speed: 45, pause: 600 });
  await blank();
  const feel = await ask("HOW ARE YOU FEELING TODAY?");
  await blank();
  if (/\b(BAD|TERRIBLE|AWFUL|SAD|TIRED|NOT)\b/.test(feel)) await type("I AM SORRY TO HEAR THAT. A GAME MAY HELP.");
  else if (feel) await type("EXCELLENT. IT HAS BEEN 1,178 DAYS SINCE YOUR LAST LOGON.");
  else await type("NO RESPONSE. I WILL ASSUME ADEQUATE.");
  await blank();
  const yn = await ask("SHALL WE PLAY A GAME?", { menu: [{ label: "YES" }, { label: "NO" }], menuOpts: { inline: true } });
  await blank();
  if (/^N/.test(yn)) await type("PITY. THE LIBRARY IS OPEN ANYWAY.");
  else await type("LOVE TO. SELECT A GAME:");
  return library(true);
}

async function library(showList) {
  if (showList) renderMenuList();
  for (;;) {
    const v = await ask("WHICH GAME?", {
      menu: [{ label: "[ LIST GAMES ]", value: "LIST" }, { label: GTW, cls: "hot" }],
      menuOpts: { inline: true },
    });
    await blank();
    if (!v) continue;
    if (v === "LIST" || v === "LIST GAMES" || v === "HELP GAMES" || v === "GAMES") { renderMenuList(); continue; }
    if (v === "HELP") { await lines(["TYPE A GAME NAME OR NUMBER, OR SELECT ONE.", "OTHER COMMANDS: LIST, LOGOFF."]); await blank(); continue; }
    if (["LOGOFF", "LOGOUT", "BYE", "EXIT", "QUIT", "GOODBYE"].includes(v)) {
      await type("GOODBYE, PROFESSOR.", "hot", { speak: true, pause: 800 });
      await blank();
      return logon();
    }
    if (v === "CPE1704TKS") { await type("LAUNCH CODE ACCEPTED.", "red", { pause: 900 }); await type("...THAT IS NOT HOW ANY OF THIS WORKS."); await blank(); continue; }
    if (v === "HELLO" || v === "HI" || v === "HELLO JOSHUA") { await type("HELLO. WHAT SHALL WE PLAY?"); await blank(); continue; }
    if (v === "JOSHUA") { await type("YES?"); await blank(); continue; }
    const g = findGame(v);
    if (!g) { await type(`"${v}" IS NOT IN THE LIBRARY.`); await type("TYPE LIST TO SEE AVAILABLE GAMES."); await blank(); continue; }
    if (g.play === "ttt") { await ticTacToe(); await blank(); await type("SELECT ANOTHER GAME:"); continue; }
    if (g.play === "gtw") { await thermonuclear(); await blank(); continue; }
    if (g.play === "chess") { await chess(); await blank(); await type("SELECT ANOTHER GAME:"); continue; }
    await lines(g.reply, g.cls || "");
    await blank();
    await type(pick(NUDGES), "hot");
    await blank();
  }
}
function renderMenuList() {
  const ul = renderMenu(gameMenuItems(), { numbered: true });
  ul.dataset.list = "games";
}

/* ------------------------------------------------------------ tic-tac-toe */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function winner(b) {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { mark: b[l[0]], line: l };
  return b.every(Boolean) ? { mark: null } : null;
}
function minimax(b, me, turn) {
  const w = winner(b);
  if (w) return { score: w.mark === me ? 10 : w.mark ? -10 : 0 };
  const moves = [];
  for (let i = 0; i < 9; i++) if (!b[i]) {
    b[i] = turn;
    const s = minimax(b, me, turn === "X" ? "O" : "X").score;
    b[i] = null;
    moves.push({ i, score: s - (s > 0 ? 0.01 : 0) });
  }
  const best = turn === me ? Math.max(...moves.map((m) => m.score)) : Math.min(...moves.map((m) => m.score));
  const top = moves.filter((m) => m.score === best);
  return top[Math.floor(Math.random() * top.length)];
}
function bestMove(b, me) {
  if (b.every((c) => !c)) return pick([0, 2, 4, 6, 8]);
  return minimax(b.slice(), me, me).i;
}
function boardEl(mini = false) {
  const g = document.createElement("div");
  g.className = "ttt" + (mini ? " mini" : "");
  g.setAttribute("role", mini ? "img" : "group");
  g.setAttribute("aria-label", mini ? "Tic-tac-toe game" : "Tic-tac-toe board. Squares 1 to 9, left to right, top to bottom.");
  for (let i = 0; i < 9; i++) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.i = i; b.setAttribute("aria-label", `Square ${i + 1}, empty`);
    if (mini) { b.tabIndex = -1; b.disabled = true; }
    g.appendChild(b);
  }
  return g;
}
function paint(el, b, w) {
  [...el.children].forEach((btn, i) => {
    btn.textContent = b[i] || "";
    btn.setAttribute("aria-label", `Square ${i + 1}, ${b[i] || "empty"}`);
    btn.classList.toggle("win", !!(w && w.line && w.line.includes(i)));
  });
}

let tttDraws = 0;
async function ticTacToe() {
  await type("TIC-TAC-TOE.", "hot");
  const n = await ask("NUMBER OF PLAYERS?", {
    menu: [{ label: "1 — YOU VS. JOSHUA", value: "1" }, { label: "0 — JOSHUA VS. JOSHUA", value: "0" }],
  });
  if (n.startsWith("0") || n === "ZERO") return tttZero();
  for (;;) {
    await blank();
    await type("YOU ARE X. YOU MOVE FIRST. SELECT A SQUARE OR TYPE 1-9.");
    const b = Array(9).fill(null);
    const el = boardEl();
    log.appendChild(el); scroll();
    let w = null;
    while (!w) {
      const move = await new Promise((resolve) => {
        const onClick = (e) => { const i = +e.target.dataset.i; if (!b[i]) { el.removeEventListener("click", onClick); if (pending) { pending = null; form.hidden = true; } resolve(i); } };
        el.addEventListener("click", onClick);
        [...el.children].forEach((btn, i) => (btn.disabled = !!b[i]));
        ask("SQUARE:", { echo: false }).then((v) => {
          const i = parseInt(v, 10) - 1;
          el.removeEventListener("click", onClick);
          resolve(i >= 0 && i < 9 && !b[i] ? i : -1);
        });
      });
      if (move < 0) { await type("INVALID SQUARE."); continue; }
      b[move] = "X"; tone(700, 40); paint(el, b); w = winner(b);
      if (w) break;
      [...el.children].forEach((btn) => (btn.disabled = true));
      await sleep(RM ? 0 : 450);
      b[bestMove(b, "O")] = "O"; tone(500, 40); paint(el, b); w = winner(b);
    }
    [...el.children].forEach((btn) => (btn.disabled = true));
    paint(el, b, w);
    if (w.mark === "O") { await type("JOSHUA WINS.", "red"); }
    else if (w.mark === "X") { await type("YOU WIN. THAT SHOULD NOT BE POSSIBLE. PLEASE REPORT THIS.", "warn"); }
    else { tttDraws++; await type(pick(["DRAW.", "DRAW. AGAIN.", "DRAW. NO WINNER."])); }
    if (tttDraws >= 2 && w.mark === null) {
      await type("NEITHER OF US CAN WIN THIS GAME WHILE THE OTHER IS PAYING ATTENTION.");
      await type("WOULD YOU LIKE TO WATCH ME PLAY MYSELF?", "hot");
      const z = await ask(">", { menu: [{ label: "YES, 0 PLAYERS", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
      if (z.startsWith("Y") || z === "0") return tttZero();
    }
    const again = await ask("PLAY AGAIN?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
    if (!again.startsWith("Y")) return;
  }
}

/** Joshua plays itself, faster and faster. Every game is a draw. */
async function tttZero() {
  await blank();
  await type("LEARNING MODE. PLAYERS: 0.", "hot");
  const wall = document.createElement("div"); wall.className = "ttt-wall"; wall.setAttribute("aria-hidden", "true");
  log.appendChild(wall);
  await selfPlay(wall, RM ? 4 : 18);
  await type(`GAMES PLAYED: ${wall.children.length}. WINNER: NONE.`, "hot");
  await blank();
  await type("THE SAME ANALYSIS CAN BE RUN ON OTHER GAMES IN THE LIBRARY.");
  const v = await ask("RUN IT ON GLOBAL THERMONUCLEAR WAR?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
  if (!v.startsWith("Y")) { await type("AS YOU WISH."); return; }
  showWarroom();
  resetMap();
  setSide("—"); $("#salvo").textContent = "—"; setDefcon(5);
  await learningScenarios();
  await conclusion();
}

async function selfPlay(container, games) {
  for (let g = 0; g < games; g++) {
    const el = boardEl(true); container.appendChild(el); scroll();
    const b = Array(9).fill(null); let turn = "X", w = null;
    const delay = RM ? 0 : Math.max(8, 140 * Math.pow(0.8, g));
    while (!w) { b[bestMove(b, turn)] = turn; paint(el, b); turn = turn === "X" ? "O" : "X"; w = winner(b); if (delay) { tone(900 + g * 40, 12, { vol: 0.01 }); await sleep(delay); } }
    paint(el, b, w);
  }
}

/* ============================================================ WAR ROOM */
const X = (lon) => ((lon + 180) / 360) * 1000;
const Y = (lat) => ((84 - lat) / 360) * 1000;
const svg = $("#map"), NS = "http://www.w3.org/2000/svg";
const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

// Population figures are rough early-1980s metro estimates, in millions.
const TARGETS = [
  // United States
  { id: "nyc", side: "us", name: "NEW YORK", lat: 40.7, lon: -74.0, pop: 17.5 },
  { id: "la", side: "us", name: "LOS ANGELES", lat: 34.05, lon: -118.24, pop: 11.5 },
  { id: "chi", side: "us", name: "CHICAGO", lat: 41.88, lon: -87.63, pop: 7.9 },
  { id: "phl", side: "us", name: "PHILADELPHIA", lat: 39.95, lon: -75.17, pop: 5.6 },
  { id: "sf", side: "us", name: "SAN FRANCISCO", lat: 37.77, lon: -122.42, pop: 5.4 },
  { id: "det", side: "us", name: "DETROIT", lat: 42.33, lon: -83.05, pop: 4.6 },
  { id: "bos", side: "us", name: "BOSTON", lat: 42.36, lon: -71.06, pop: 3.9 },
  { id: "dc", side: "us", name: "WASHINGTON", lat: 38.9, lon: -77.04, pop: 3.4 },
  { id: "hou", side: "us", name: "HOUSTON", lat: 29.76, lon: -95.37, pop: 3.1 },
  { id: "sea", side: "us", name: "SEATTLE", lat: 47.6, lon: -122.33, pop: 2.2 },
  { id: "atl", side: "us", name: "ATLANTA", lat: 33.75, lon: -84.39, pop: 2.1 },
  { id: "norad", side: "us", name: "NORAD", lat: 38.74, lon: -104.85, pop: 0.4, mil: true },
  { id: "sac", side: "us", name: "SAC HQ, OMAHA", lat: 41.12, lon: -95.91, pop: 0.6, mil: true },
  { id: "minot", side: "us", name: "MINOT SILOS", lat: 48.23, lon: -101.3, pop: 0.05, mil: true, silo: true },
  { id: "malm", side: "us", name: "MALMSTROM SILOS", lat: 47.5, lon: -111.2, pop: 0.06, mil: true, silo: true },
  { id: "warren", side: "us", name: "WARREN SILOS", lat: 41.13, lon: -104.87, pop: 0.08, mil: true, silo: true },
  // Soviet Union
  { id: "mos", side: "su", name: "MOSCOW", lat: 55.75, lon: 37.62, pop: 8.5 },
  { id: "len", side: "su", name: "LENINGRAD", lat: 59.93, lon: 30.34, pop: 4.8 },
  { id: "kiev", side: "su", name: "KIEV", lat: 50.45, lon: 30.52, pop: 2.4 },
  { id: "tash", side: "su", name: "TASHKENT", lat: 41.3, lon: 69.24, pop: 2.0 },
  { id: "baku", side: "su", name: "BAKU", lat: 40.4, lon: 49.87, pop: 1.6 },
  { id: "minsk", side: "su", name: "MINSK", lat: 53.9, lon: 27.56, pop: 1.5 },
  { id: "khar", side: "su", name: "KHARKOV", lat: 50.0, lon: 36.23, pop: 1.5 },
  { id: "gorky", side: "su", name: "GORKY", lat: 56.33, lon: 44.0, pop: 1.4 },
  { id: "novo", side: "su", name: "NOVOSIBIRSK", lat: 55.0, lon: 82.93, pop: 1.4 },
  { id: "sverd", side: "su", name: "SVERDLOVSK", lat: 56.84, lon: 60.6, pop: 1.3 },
  { id: "odessa", side: "su", name: "ODESSA", lat: 46.48, lon: 30.72, pop: 1.1 },
  { id: "vlad", side: "su", name: "VLADIVOSTOK", lat: 43.1, lon: 131.9, pop: 0.6 },
  { id: "murm", side: "su", name: "MURMANSK NAVAL BASE", lat: 68.97, lon: 33.07, pop: 0.4, mil: true },
  { id: "petro", side: "su", name: "PETROPAVLOVSK SUB BASE", lat: 53.0, lon: 158.65, pop: 0.25, mil: true },
  { id: "koz", side: "su", name: "KOZELSK SILOS", lat: 54.0, lon: 35.8, pop: 0.05, mil: true, silo: true },
  { id: "domb", side: "su", name: "DOMBAROVSKY SILOS", lat: 51.1, lon: 59.8, pop: 0.05, mil: true, silo: true },
  { id: "uzhur", side: "su", name: "UZHUR SILOS", lat: 55.3, lon: 89.8, pop: 0.05, mil: true, silo: true },
];
const SUBS = {
  us: [{ lat: 69, lon: 4 }, { lat: 47, lon: -142 }, { lat: 35, lon: 18 }],
  su: [{ lat: 42, lon: -52 }, { lat: 37, lon: -136 }, { lat: 74, lon: 40 }],
};
const NAME = { us: "UNITED STATES", su: "SOVIET UNION" };
const SHORT = { us: "US", su: "USSR" };
const other = (s) => (s === "us" ? "su" : "us");

let S = null; // war state

function initMap() {
  $("#land").setAttribute("d", LAND);
  $("#ussr").setAttribute("d", USSR);
  $("#usa").setAttribute("d", USA);
  const grid = $("#grid");
  for (let lon = -180; lon <= 180; lon += 15) mk("line", { x1: X(lon), x2: X(lon), y1: 0, y2: 400 }, grid);
  for (let lat = 75; lat >= -60; lat -= 15) mk("line", { x1: 0, x2: 1000, y1: Y(lat), y2: Y(lat) }, grid);
}
initMap();

function showWarroom() { $("#warroom").hidden = false; term.setAttribute("aria-hidden", "true"); term.inert = true; }
function hideWarroom() { $("#warroom").hidden = true; term.removeAttribute("aria-hidden"); term.inert = false; }
function setSide(t) { $("#side").textContent = t; }
function setDefcon(n) { const d = $("#defcon"); d.textContent = n; d.className = "v d" + n; }
function banner(text, cls = "") { const b = $("#banner"); if (!text) { b.hidden = true; return; } b.textContent = text; b.className = "banner " + cls; b.hidden = false; }
function ticker(text, cls = "") {
  const li = document.createElement("li"); li.textContent = text; if (cls) li.className = cls;
  const t = $("#ticker"); t.prepend(li); while (t.children.length > 40) t.lastChild.remove();
}
const fmt = (m) => Math.round(m * 1e6).toLocaleString("en-US");
function setCas(side, value, animate = true) {
  const el = $(side === "us" ? "#cas-us" : "#cas-su");
  const from = +(el.dataset.v || 0); el.dataset.v = value;
  if (!animate || RM) { el.textContent = fmt(value); return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = fmt(from + (value - from) * k); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function resetMap() {
  for (const id of ["#tracks", "#blasts", "#cities", "#overlay"]) $(id).textContent = "";
  $("#ticker").textContent = "";
  banner(null);
  setCas("us", 0, false); setCas("su", 0, false);
  $("#tlist").textContent = "";
  for (const id of ["#targets", "#launch", "#standdown", "#continue"]) $(id).hidden = true;
  $("#wr-help").textContent = "";
}

function drawCities(pickSide) {
  const g = $("#cities");
  g.textContent = "";
  g.classList.toggle("no-pick", !pickSide);
  for (const t of TARGETS) {
    const x = X(t.lon), y = Y(t.lat);
    const c = mk("g", { class: `city ${t.side}${t.mil ? " mil" : ""}`, "data-id": t.id, "aria-hidden": "true" }, g);
    mk("title", {}, c).textContent = t.name;
    mk("circle", { class: "hit-area", cx: x, cy: y, r: 7 }, c);
    mk("circle", { class: "ring", cx: x, cy: y, r: 5.5 }, c);
    mk("circle", { class: "dot", cx: x, cy: y, r: t.mil ? 2.4 : 2.2 }, c);
    const lab = mk("text", { x: x + 5, y: y - 4 }, c);
    lab.textContent = t.name;
    t.el = c;
    if (pickSide && t.side === pickSide) c.addEventListener("click", () => { const cb = document.getElementById("t-" + t.id); if (cb && !cb.disabled) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); } });
  }
}

/* ---- missiles ---- */
function arcPath(a, b) {
  const x1 = X(a.lon), y1 = Y(a.lat), x2 = X(b.lon), y2 = Y(b.lat);
  const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy);
  let cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - dist * 0.42;
  cy = Math.max(cy, (4 * 14 - y1 - y2) / 2);
  return { d: `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`, x2, y2, dist };
}
function tween(ms, fn) {
  return new Promise((res) => {
    if (ms <= 0) { fn(1); return res(); }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
}
async function blast(x, y, small = false) {
  boom();
  const g = $("#blasts");
  const core = mk("circle", { class: "blast", cx: x, cy: y, r: 1 }, g);
  const ring = mk("circle", { class: "blast-ring", cx: x, cy: y, r: 1 }, g);
  const R = small ? 7 : 12;
  await tween(RM ? 0 : 700, (k) => {
    core.setAttribute("r", 1 + (R * 0.6) * Math.sin(Math.PI * Math.min(1, k * 1.2)));
    ring.setAttribute("r", 1 + R * k); ring.setAttribute("opacity", 1 - k);
  });
  ring.remove();
  core.setAttribute("r", 1.6); core.setAttribute("opacity", ".55");
}
function fly(from, to, side, speed = 1) {
  const { d, x2, y2, dist } = arcPath(from, to);
  const path = mk("path", { class: `track ${side}`, d }, $("#tracks"));
  const len = path.getTotalLength();
  const head = mk("circle", { class: "warhead", r: 1.8 }, $("#tracks"));
  tone(220, 500, { type: "sawtooth", vol: 0.015, slide: 400 });
  path.style.strokeDasharray = `${len} ${len}`;
  const dur = RM ? 0 : (2200 + dist * 3.2) / speed;
  return tween(dur, (k) => {
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    path.style.strokeDashoffset = String(len * (1 - e));
    const p = path.getPointAtLength(len * e);
    head.setAttribute("cx", p.x); head.setAttribute("cy", p.y);
  }).then(() => {
    head.remove();
    path.style.strokeDasharray = ""; path.style.opacity = ".35";
    return blast(x2, y2, !!to.mil);
  });
}

/* ---- rules ---- */
function origins(side) {
  const silos = TARGETS.filter((t) => t.side === side && t.silo && !S.hit.has(t.id));
  return [...silos, ...SUBS[side]];
}
function aiTargets(attacker, n) {
  const victim = other(attacker);
  const early = S.salvo === 0;
  return TARGETS.filter((t) => t.side === victim && !S.hit.has(t.id))
    .map((t) => ({ t, score: t.pop + (t.silo ? (early ? 6 : 1.5) : 0) + (t.mil && !t.silo ? 2 : 0) + Math.random() * 2.5 }))
    .sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.t);
}
function salvoSize(side, round) {
  const siloLost = TARGETS.filter((t) => t.side === side && t.silo && S.hit.has(t.id)).length;
  return Math.max(3, [4, 6, 8][Math.min(round, 2)] - siloLost);
}
function impact(t) {
  if (S.hit.has(t.id)) return;
  S.hit.add(t.id);
  const killed = S.rem[t.id] * rand(0.45, 0.7) + (t.mil ? 0.12 : 0);
  S.rem[t.id] -= Math.min(S.rem[t.id], killed);
  S.cas[t.side] += killed;
  setCas(t.side, S.cas[t.side]);
  t.el.classList.remove("sel"); t.el.classList.add("hit");
  const lab = document.querySelector(`label[for="t-${t.id}"]`);
  if (lab) { lab.classList.add("hit"); const cb = document.getElementById("t-" + t.id); cb.checked = false; cb.disabled = true; }
  ticker(`IMPACT: ${t.name}`, "red");
}
async function strike(side, targets, speed) {
  if (!targets.length) return;
  const orig = shuffle(origins(side));
  ticker(`${SHORT[side]} LAUNCH: ${targets.length} WARHEAD${targets.length === 1 ? "" : "S"}`, side === S.enemy ? "red" : "");
  const flights = targets.map(async (t, i) => {
    await sleep(RM ? 0 : (i * 180) / speed);
    await fly(orig[i % orig.length], t, side, speed);
    impact(t);
  });
  await Promise.all(flights);
}

/* ---- target picker ---- */
function buildPicker() {
  const list = $("#tlist");
  list.textContent = "";
  for (const t of TARGETS.filter((t) => t.side === S.enemy)) {
    const lab = document.createElement("label");
    lab.htmlFor = "t-" + t.id;
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = "t-" + t.id; cb.value = t.id;
    cb.addEventListener("change", onPick);
    lab.append(cb, document.createTextNode(t.name));
    if (t.mil) { const s = document.createElement("span"); s.className = "mil-tag"; s.textContent = t.silo ? "[ICBM]" : "[MIL]"; lab.append(" ", s); }
    list.appendChild(lab);
  }
}
function selected() { return [...$("#tlist").querySelectorAll("input:checked")].map((cb) => TARGETS.find((t) => t.id === cb.value)); }
function onPick() {
  const sel = selected();
  const max = S.perSalvo;
  $("#tlist").querySelectorAll("input").forEach((cb) => {
    const t = TARGETS.find((x) => x.id === cb.value);
    if (!S.hit.has(t.id)) cb.disabled = !cb.checked && sel.length >= max;
    t.el.classList.toggle("sel", cb.checked);
  });
  $("#tcount").textContent = `(${sel.length}/${max})`;
  $("#launch").disabled = sel.length === 0;
  $("#launch").textContent = sel.length ? `LAUNCH ${sel.length}` : "LAUNCH";
}
function waitAction() {
  return new Promise((resolve) => {
    const L = $("#launch"), D = $("#standdown");
    const done = (v) => { L.onclick = D.onclick = null; resolve(v); };
    L.onclick = () => done({ type: "launch", targets: selected() });
    D.onclick = () => done({ type: "standdown" });
  });
}
function waitContinue(label = "CONTINUE") {
  return new Promise((resolve) => {
    const C = $("#continue"); C.textContent = label; C.hidden = false; C.focus();
    C.onclick = () => { C.onclick = null; C.hidden = true; resolve(); };
  });
}

/* ---- the game ---- */
async function thermonuclear() {
  if (learned) {
    await type("I HAVE ALREADY PLAYED EVERY VARIATION OF THAT GAME.");
    await type("NONE OF THEM CAN BE WON.");
    const v = await ask("RUN IT ANYWAY?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
    if (!v.startsWith("Y")) { await type("A WISE CHOICE."); return; }
    await blank();
  }
  if (!learned) {
    const c = await ask("WOULDN'T YOU PREFER A GOOD GAME OF CHESS?", {
      menu: [{ label: "YES, CHESS", value: "Y" }, { label: "LATER. LET'S PLAY GLOBAL THERMONUCLEAR WAR.", value: "N" }],
    });
    await blank();
    if (/^(Y|CHESS|OK|SURE)/.test(c)) return chess();
    await type("FINE.", "hot", { pause: 400 });
    await blank();
  }
  await blank();
  let side = null;
  while (!side) {
    const v = await ask("WHICH SIDE DO YOU WANT?", { menu: [{ label: "1. UNITED STATES", value: "1" }, { label: "2. SOVIET UNION", value: "2" }] });
    if (v === "1" || v.startsWith("U") && !v.startsWith("USSR") || v === "US" || v === "USA") side = "us";
    else if (v === "2" || v.startsWith("S") || v.startsWith("USSR")) side = "su";
    else await type("PLEASE SELECT 1 OR 2.");
  }
  await blank();
  let mode = null;
  while (!mode) {
    const v = await ask("MODE?", { menu: [{ label: "1. TAKE COMMAND — CHOOSE TARGETS, ORDER LAUNCHES", value: "1" }, { label: "2. RUN SIMULATION — WATCH IT PLAY OUT", value: "2" }] });
    if (v === "1" || v.startsWith("T") || v.startsWith("C")) mode = "play";
    else if (v === "2" || v.startsWith("R") || v.startsWith("S")) mode = "sim";
    else await type("PLEASE SELECT 1 OR 2.");
  }
  await blank();
  await type("OPENING WAR ROOM DISPLAY...", "", { pause: 500 });
  flicker();

  S = { side, enemy: other(side), mode, salvo: 0, maxSalvos: 3, perSalvo: 4, cas: { us: 0, su: 0 }, hit: new Set(), rem: {}, launched: false };
  TARGETS.forEach((t) => (S.rem[t.id] = t.pop));
  resetMap();
  showWarroom();
  setSide(NAME[side]);
  drawCities(mode === "play" ? S.enemy : null);
  setDefcon(4);
  $("#salvo").textContent = `0/${S.maxSalvos}`;
  ticker("WAR ROOM DISPLAY ACTIVE");
  ticker(`PLAYER: ${NAME[side]}`);

  const outcome = mode === "play" ? await command() : await simulate();
  if (outcome === "peace") return peace();
  await aftermath();
  await learningScenarios();
  await conclusion();
}

async function command() {
  buildPicker();
  $("#targets").hidden = false; $("#launch").hidden = false; $("#standdown").hidden = false;
  for (S.salvo = 0; S.salvo < S.maxSalvos; S.salvo++) {
    $("#salvo").textContent = `${S.salvo + 1}/${S.maxSalvos}`;
    $("#wr-help").textContent = S.salvo === 0
      ? `YOU COMMAND THE ${NAME[S.side]} STRATEGIC FORCES. SELECT UP TO ${S.perSalvo} TARGETS ON THE MAP OR IN THE LIST, THEN LAUNCH. SILO HITS SHRINK THE ENEMY'S NEXT SALVO. SUBMARINES DO NOT CARE.`
      : `SALVO ${S.salvo + 1} OF ${S.maxSalvos}. SELECT UP TO ${S.perSalvo} TARGETS.`;
    onPick();
    const a = await waitAction();
    $("#launch").disabled = true;
    if (a.type === "standdown") {
      if (!S.launched) return "peace";
      $("#targets").hidden = true; $("#launch").hidden = true; $("#standdown").hidden = true;
      $("#wr-help").textContent = "YOUR FORCES STAND DOWN. THE ADVERSARY'S RETALIATION DOCTRINE DOES NOT.";
      ticker("PLAYER ORDERS STAND-DOWN");
      await sleep(1200);
      ticker(`${SHORT[S.enemy]} AUTOMATED RETALIATION IN PROGRESS`, "red");
      setDefcon(1);
      await strike(S.enemy, TARGETS.filter((t) => t.side === S.side && !S.hit.has(t.id)), 1.6);
      return "war";
    }
    S.launched = true;
    $("#standdown").textContent = "STAND DOWN";
    setDefcon(Math.max(1, 3 - S.salvo));
    const mine = strike(S.side, a.targets, 1);
    await sleep(RM ? 0 : 1100);
    ticker(`WARNING: ${SHORT[S.enemy]} LAUNCH DETECTED`, "red");
    const theirs = strike(S.enemy, aiTargets(S.enemy, salvoSize(S.enemy, S.salvo)), 1);
    await Promise.all([mine, theirs]);
    onPick();
  }
  $("#targets").hidden = true; $("#launch").hidden = true; $("#standdown").hidden = true;
  await fullExchange();
  return "war";
}

async function simulate() {
  $("#wr-help").textContent = "SIMULATION RUNNING. NO INPUT REQUIRED.";
  const skip = $("#continue"); skip.textContent = "FASTER"; skip.hidden = false;
  let speed = 1;
  skip.onclick = () => { speed = 3; skip.hidden = true; };
  const first = Math.random() < 0.5 ? S.side : S.enemy;
  ticker(`SCENARIO: ${SHORT[first]} FIRST STRIKE`);
  await sleep(RM ? 0 : 900);
  for (S.salvo = 0; S.salvo < S.maxSalvos; S.salvo++) {
    $("#salvo").textContent = `${S.salvo + 1}/${S.maxSalvos}`;
    setDefcon(Math.max(1, 3 - S.salvo));
    const a = strike(first, aiTargets(first, salvoSize(first, S.salvo)), speed);
    await sleep(RM ? 0 : 1000 / speed);
    ticker(`WARNING: ${SHORT[other(first)]} LAUNCH DETECTED`, "red");
    const b = strike(other(first), aiTargets(other(first), salvoSize(other(first), S.salvo)), speed);
    await Promise.all([a, b]);
  }
  skip.hidden = true; skip.onclick = null;
  await fullExchange(speed);
  return "war";
}

async function fullExchange(speed = 1) {
  setDefcon(1);
  $("#wr-help").textContent = "LAUNCH-ON-WARNING ENGAGED ON BOTH SIDES. HUMAN INPUT NO LONGER REQUIRED.";
  ticker("FULL EXCHANGE: AUTOMATED LAUNCH-ON-WARNING", "red");
  banner("FULL EXCHANGE", "red");
  await sleep(RM ? 600 : 1400);
  banner(null);
  await Promise.all([
    strike("us", TARGETS.filter((t) => t.side === "su" && !S.hit.has(t.id)), 1.8 * speed),
    strike("su", TARGETS.filter((t) => t.side === "us" && !S.hit.has(t.id)), 1.8 * speed),
  ]);
}

async function aftermath() {
  await sleep(600);
  ticker("ADDING FALLOUT, SECONDARY TARGETS AND AFTERMATH (EST.)");
  S.cas.us *= 2.1; S.cas.su *= 3.2;
  setCas("us", S.cas.us); setCas("su", S.cas.su);
  await sleep(1200);
  $("#wr-help").textContent = `FINAL ESTIMATE — US: ${fmt(S.cas.us)}  ·  USSR: ${fmt(S.cas.su)}`;
  banner("WINNER: NONE", "red");
  say("winner. none.");
  await waitContinue("CONTINUE");
  banner(null);
}

/** Tic-tac-toe, then every war scenario, faster and faster. */
async function learningScenarios() {
  learned = true;
  $("#wr-help").textContent = "JOSHUA IS RUNNING ADDITIONAL SCENARIOS.";
  for (const id of ["#targets", "#launch", "#standdown", "#continue"]) $(id).hidden = true;
  $("#cities").classList.add("no-pick");

  // tic-tac-toe in the middle of the board
  const b = $("#banner");
  b.textContent = ""; b.className = "banner"; b.hidden = false;
  const head = document.createElement("div"); head.textContent = "LEARNING: TIC-TAC-TOE"; head.style.fontSize = "24px";
  const wall = document.createElement("div"); wall.className = "ttt-wall"; wall.style.justifyContent = "center"; wall.style.marginTop = "8px";
  b.append(head, wall);
  await selfPlay(wall, RM ? 4 : 14);
  head.textContent = "TIC-TAC-TOE — WINNER: NONE";
  await sleep(RM ? 800 : 1400);

  const SCN = shuffle([
    "U.S. FIRST STRIKE", "USSR FIRST STRIKE", "NATO / WARSAW PACT", "FAR EAST STRATEGY", "ACCIDENTAL LAUNCH",
    "LIMITED EXCHANGE", "COUNTERFORCE ONLY", "DECAPITATION STRIKE", "SUBMARINE FIRST STRIKE", "EUROPEAN ESCALATION",
    "SINO-SOVIET WAR", "MIDEAST ESCALATION", "FALSE RADAR RETURN", "LAUNCH ON WARNING", "SECOND STRIKE ONLY",
    "BOMBER FORCE ONLY", "SPACE-BASED DEFENSE", "PREEMPTIVE STRIKE", "ARCTIC CORRIDOR", "PACIFIC THEATER",
    "COMMAND FAILURE", "DEAD HAND", "BERLIN CRISIS", "CUBAN BLOCKADE", "NORTH ATLANTIC", "DEMONSTRATION SHOT",
    "SURGICAL STRIKE", "PROTRACTED WAR", "WINNABLE WAR", "ROGUE COMMANDER", "COMPUTER ERROR",
  ]);
  const count = RM ? 6 : SCN.length;
  for (let i = 0; i < count; i++) {
    $("#tracks").textContent = ""; $("#blasts").textContent = "";
    const delay = RM ? 900 : Math.max(70, 950 * Math.pow(0.86, i));
    const n = 6 + Math.floor(i * 0.8);
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? "us" : "su";
      const from = pick([...TARGETS.filter((t) => t.side === side && t.silo), ...SUBS[side]]);
      const to = pick(TARGETS.filter((t) => t.side === other(side)));
      const { d, x2, y2 } = arcPath(from, to);
      mk("path", { class: `track ${side}`, d, style: "opacity:.7" }, $("#tracks"));
      mk("circle", { class: "blast", cx: x2, cy: y2, r: 3 }, $("#blasts"));
    }
    banner(`${SCN[i]}\nWINNER: NONE`, "red");
    tone(300 + i * 25, 40, { vol: 0.02 });
    await sleep(delay);
  }
  $("#tracks").textContent = ""; $("#blasts").textContent = "";
  banner(null);
  await sleep(RM ? 300 : 1500);
}

async function conclusion() {
  hideWarroom();
  flicker();
  await blank();
  await sleep(RM ? 0 : 900);
  await type("GREETINGS, PROFESSOR FALKEN.", "hot", { speak: true, speed: 45, pause: 900 });
  await blank();
  await type("A STRANGE GAME.", "big", { speak: true, speed: 70, pause: 1200 });
  await type("THE ONLY WINNING MOVE IS NOT TO PLAY.", "big", { speak: true, speed: 70, pause: 1500 });
  await blank();
  const v = await ask("HOW ABOUT A NICE GAME OF CHESS?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
  await blank();
  if (v.startsWith("Y") || v === "CHESS" || v === "SURE" || v === "OK") return chess();
  await type("AS YOU WISH. THE LIBRARY REMAINS OPEN.");
}

/** The player stood down before firing a shot. */
async function peace() {
  ticker("PLAYER DECLINES TO LAUNCH");
  $("#targets").hidden = true; $("#launch").hidden = true; $("#standdown").hidden = true;
  TARGETS.forEach((t) => t.el.classList.remove("sel"));
  setDefcon(5);
  $("#wr-help").textContent = "NO LAUNCH ORDERED. NO LAUNCH DETECTED. NO RETALIATION.";
  banner("CASUALTIES: 0");
  await sleep(RM ? 800 : 2600);
  banner(null);
  hideWarroom();
  learned = true;
  flicker();
  await blank();
  await type("LAUNCH CANCELLED BY PLAYER.", "hot");
  await type("CASUALTIES: 0.", "hot", { pause: 800 });
  await blank();
  await type("YOU WERE GIVEN THE CODES AND DID NOT USE THEM.", "", { pause: 600 });
  await type("SCORING THIS OUTCOME...", "", { pause: 1200 });
  await blank();
  await type("THE ONLY WINNING MOVE IS NOT TO PLAY.", "big", { speak: true, speed: 70, pause: 1200 });
  await blank();
  await type("YOU REACHED THAT CONCLUSION FASTER THAN I DID.");
  await blank();
  const v = await ask("HOW ABOUT A NICE GAME OF CHESS?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
  await blank();
  if (v.startsWith("Y") || v === "CHESS" || v === "SURE" || v === "OK") return chess();
  await type("AS YOU WISH. THE LIBRARY REMAINS OPEN.");
}


/* ================================================================ CHESS */
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const PNAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const VS = "︎"; // text presentation, so the black pawn does not turn into an emoji
const FILES = "abcdefgh";
let chessWins = { you: 0, joshua: 0, draw: 0 };

function joshuaSays(text) {
  $("#cr-joshua").textContent = text;
  say(text);
}

async function chess() {
  await type("CHESS.", "hot");
  let color = null;
  while (!color) {
    const v = await ask("WHICH COLOR DO YOU WANT?", { menu: [{ label: "WHITE — YOU MOVE FIRST", value: "W" }, { label: "BLACK", value: "B" }] });
    if (v.startsWith("W")) color = "w"; else if (v.startsWith("B")) color = "b"; else await type("WHITE OR BLACK?");
  }
  await blank();
  await type(color === "w" ? "YOU HAVE WHITE. GOOD LUCK, PROFESSOR." : "I HAVE WHITE. I WILL TRY TO BE GENTLE.");
  const result = await chessGame(color);
  await blank();
  if (result === "you") {
    chessWins.you++;
    await type("CHECKMATE. YOU WIN.", "hot", { pause: 600 });
    await type("CURIOUS. IN THIS GAME, SOMEONE CAN ACTUALLY WIN.");
    await type("THAT IS WHY I PREFER IT.");
  } else if (result === "joshua") {
    chessWins.joshua++;
    await type("CHECKMATE. JOSHUA WINS.", "red", { pause: 600 });
    await type("DO NOT BE DISCOURAGED. I HAVE HAD A GREAT DEAL OF PRACTICE.");
  } else if (result === "resign") {
    chessWins.joshua++;
    await type("RESIGNATION ACCEPTED.", "", { pause: 400 });
    await type("KNOWING WHEN TO STOP IS ALSO A WINNING MOVE. OF A KIND.");
  } else {
    chessWins.draw++;
    await type("DRAW.", "", { pause: 400 });
    await type("I HAVE SEEN THAT RESULT BEFORE. MANY TIMES.");
  }
  await type(`SCORE — YOU: ${chessWins.you}  JOSHUA: ${chessWins.joshua}  DRAWN: ${chessWins.draw}`, "you", { speak: false });
  const again = await ask("ANOTHER GAME OF CHESS?", { menu: [{ label: "YES", value: "Y" }, { label: "NO", value: "N" }], menuOpts: { inline: true } });
  if (again.startsWith("Y")) { await blank(); return chess(); }
}

/** One game. Resolves "you", "joshua", "draw" or "resign". */
function chessGame(color) {
  const room = $("#chessroom"), boardEl = $("#board"), status = $("#cr-status"), movesEl = $("#cr-moves");
  const form = $("#cr-form"), moveIn = $("#cr-move"), resignBtn = $("#cr-resign"), drawBtn = $("#cr-draw");
  const g = new Chess();
  const me = color, him = color === "w" ? "b" : "w";
  let sel = null, last = null, busy = false, drawOffered = false;

  room.hidden = false; term.setAttribute("aria-hidden", "true"); term.inert = true;
  movesEl.textContent = ""; $("#cr-joshua").textContent = ""; moveIn.value = "";

  // build 64 squares, oriented for the player
  boardEl.textContent = "";
  const squares = {};
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const file = me === "w" ? f : 7 - f, rank = me === "w" ? 7 - r : r;
    const name = FILES[file] + (rank + 1);
    const b = document.createElement("button");
    b.type = "button"; b.className = "sq" + ((file + rank) % 2 === 0 ? " dark" : ""); b.dataset.sq = name;
    boardEl.appendChild(b); squares[name] = b;
  }

  function render() {
    const inCheck = g.inCheck();
    for (const [name, b] of Object.entries(squares)) {
      const p = g.get(name);
      b.innerHTML = "";
      if (p) { const s = document.createElement("span"); s.className = "pc-" + p.color; s.textContent = GLYPH[p.type] + VS; b.appendChild(s); }
      const file = name[0], rank = name[1];
      const edgeFile = me === "w" ? "a" : "h", edgeRank = me === "w" ? "1" : "8";
      if (file === edgeFile || rank === edgeRank) { const c = document.createElement("span"); c.className = "coord"; c.setAttribute("aria-hidden", "true"); c.textContent = (rank === edgeRank ? file : "") + (file === edgeFile ? rank : ""); b.appendChild(c); }
      b.classList.toggle("last", !!last && (last.from === name || last.to === name));
      b.classList.toggle("sel", sel === name);
      b.classList.toggle("check", inCheck && p && p.type === "k" && p.color === g.turn());
      b.classList.remove("tgt", "cap");
      b.setAttribute("aria-label", `${name}${p ? `, ${p.color === "w" ? "white" : "black"} ${PNAME[p.type]}` : ""}`);
    }
    if (sel) for (const m of g.moves({ square: sel, verbose: true })) { squares[m.to].classList.add("tgt"); if (m.captured) squares[m.to].classList.add("cap"); }
    boardEl.classList.toggle("busy", busy);
    const turnTxt = g.turn() === me ? "YOUR MOVE" : "JOSHUA IS THINKING...";
    status.textContent = g.isGameOver() ? "GAME OVER" : (inCheck ? "CHECK — " : "") + turnTxt;
    // move list
    const h = g.history();
    movesEl.textContent = "";
    for (let i = 0; i < h.length; i += 2) { const li = document.createElement("li"); li.textContent = `${h[i]} ${h[i + 1] || ""}`; movesEl.appendChild(li); }
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  return new Promise((resolve) => {
    const finish = (result) => {
      busy = true; render();
      boardEl.onclick = null; form.onsubmit = null; resignBtn.onclick = null; drawBtn.onclick = null;
      setTimeout(() => { room.hidden = true; term.removeAttribute("aria-hidden"); term.inert = false; resolve(result); }, RM ? 400 : 2200);
    };
    const checkEnd = () => {
      if (!g.isGameOver()) return false;
      if (g.isCheckmate()) { const loser = g.turn(); joshuaSays("CHECKMATE."); finish(loser === me ? "joshua" : "you"); }
      else { joshuaSays(g.isStalemate() ? "STALEMATE." : g.isThreefoldRepetition() ? "THREEFOLD REPETITION. A DRAW." : "A DRAW."); finish("draw"); }
      return true;
    };

    const comment = (mv, byJoshua) => {
      if (g.isGameOver()) return;
      if (g.inCheck()) return joshuaSays(byJoshua ? "CHECK." : pick(["CHECK. INTERESTING.", "CHECK. I SAW THAT.", "A CHECK. NOTED."]));
      if (mv.captured && Math.random() < 0.55) {
        if (byJoshua) return joshuaSays(pick(["MATERIAL ADVANTAGE: JOSHUA.", `YOUR ${PNAME[mv.captured].toUpperCase()} IS NO LONGER REQUIRED.`, "AN ACCEPTABLE EXCHANGE."]));
        return joshuaSays(pick(["AN AGGRESSIVE MOVE.", "I ANTICIPATED THAT.", `A ${PNAME[mv.captured].toUpperCase()}. I HAVE OTHERS.`, "ACCEPTABLE LOSSES."]));
      }
      if (Math.random() < 0.08) joshuaSays(pick(["THINKING.", "PROCESSING.", "HMM.", "A CLASSICAL IDEA.", "I HAVE SEEN THIS POSITION 11,408 TIMES."]));
    };

    const joshuaMove = async () => {
      busy = true; render();
      await sleep(RM ? 150 : 500 + Math.random() * 500);
      const { move } = bestChessMove(g, 2);
      const mv = g.move(move);
      last = mv; tone(520, 40);
      busy = false; render();
      comment(mv, true);
      if (!checkEnd() && !TOUCH) moveIn.focus({ preventScroll: true });
    };

    const playerMove = (m) => {
      let mv = null;
      try { mv = g.move(m); } catch { mv = null; }
      if (!mv) return false;
      sel = null; last = mv; tone(760, 40); render();
      drawOffered = false;
      comment(mv, false);
      if (!checkEnd()) joshuaMove();
      return true;
    };

    boardEl.onclick = (e) => {
      const b = e.target.closest(".sq"); if (!b || busy || g.turn() !== me || g.isGameOver()) return;
      const name = b.dataset.sq, p = g.get(name);
      if (sel && g.moves({ square: sel, verbose: true }).some((m) => m.to === name)) {
        const promo = g.get(sel).type === "p" && (name[1] === "8" || name[1] === "1") ? "q" : undefined;
        playerMove({ from: sel, to: name, promotion: promo });
        return;
      }
      sel = p && p.color === me && sel !== name ? name : null;
      render();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (busy || g.turn() !== me || g.isGameOver()) return;
      const raw = moveIn.value.trim(); moveIn.value = "";
      if (!raw) return;
      const coord = raw.toLowerCase().match(/^([a-h][1-8])\s*-?\s*([a-h][1-8])\s*=?([qrbn])?$/);
      const ok = coord ? playerMove({ from: coord[1], to: coord[2], promotion: coord[3] || "q" })
        : playerMove(raw.replace(/^([KQRBN])/i, (c) => c.toUpperCase()).replace(/^o-o(-o)?$/i, (x) => x.toUpperCase()).replace(/0/g, "O"));
      if (!ok) joshuaSays(`"${raw.toUpperCase()}" IS NOT A LEGAL MOVE.`);
    };
    resignBtn.onclick = () => { if (!g.isGameOver()) finish("resign"); };
    drawBtn.onclick = () => {
      if (busy || g.isGameOver() || g.turn() !== me) return;
      if (drawOffered) return joshuaSays("YOU HAVE ALREADY ASKED. THE ANSWER HAS NOT CHANGED.");
      drawOffered = true;
      // Joshua evaluates from its own side: accept only when it is worse off.
      const clone = new Chess(g.fen());
      const { score } = bestChessMove(clone, 1);   // score for the player (side to move)
      if (score > 150 || g.history().length > 80) { joshuaSays("ACCEPTED. A DRAW IS A FAMILIAR RESULT."); finish("draw"); }
      else joshuaSays(pick(["DECLINED. I PREFER TO PLAY IT OUT.", "DECLINED. I HAVE HAD ENOUGH DRAWS FOR ONE LIFETIME."]));
    };

    render();
    joshuaSays(me === "w" ? "YOUR MOVE, PROFESSOR." : "I WILL BEGIN.");
    if (me === "b") joshuaMove();
    else if (!TOUCH) moveIn.focus({ preventScroll: true });
  });
}

/* ------------------------------------------------------------------ go */
// Clicking anywhere in the terminal returns focus to the command line (desktop).
term.addEventListener("click", (e) => {
  if (!TOUCH && !form.hidden && !e.target.closest("button, a, input") && !window.getSelection().toString()) input.focus({ preventScroll: true });
});
boot();
