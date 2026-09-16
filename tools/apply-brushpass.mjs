#!/usr/bin/env node
/* ============================================================
   apply-brushpass.mjs
   ------------------------------------------------------------
   Turns brushpass/program.json into the published Brush Pass
   pages, so the sign-up form, the Discord invite and the Play
   links are never maintained in two places.

   Vercel runs this on every deploy via `npm run build`, right
   after apply-release.mjs. It touches only files under brushpass/.

   WHAT IT REWRITES:

     <tag data-bp="dotted.key">…</tag>
         → the value from program.json (HTML-escaped)
     <a data-bp-href="signupForm|discord|playOptIn|playListing|email">…</a>
         → only the href is rewritten; contents stay as authored
     <tag data-bp-when="<condition>[:not]">…</tag>
         → `hidden` toggled by that condition. Conditions:
           signupForm, discord, playOptIn, playListing,
           closedTesting, openTesting, production

   A link whose target is not published yet is never left pointing
   at a placeholder: the element carrying data-bp-href is hidden,
   and the page's data-bp-when="signupForm:not" fallback shows.

   The committed HTML always carries the current values, so the
   pages are correct even if this never runs. Running it twice is
   a no-op.
   ============================================================ */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "brushpass");

const cfg = JSON.parse(await readFile(join(DIR, "program.json"), "utf8"));

const problems = [];
const fail = (m) => problems.push(m);
const isHttps = (u) => typeof u === "string" && /^https:\/\/\S+$/.test(u);
const isBlank = (u) => u === undefined || u === null || u === "";

/* ---------- validate ---------- */

const STAGES = ["closed-testing", "open-testing", "production"];
if (!STAGES.includes(cfg.stage)) fail(`stage must be one of ${STAGES.join(", ")}, got "${cfg.stage}"`);

const urlField = (path, value, opts = {}) => {
  if (isBlank(value)) return;
  if (!isHttps(value)) fail(`${path} must be an https:// URL or "", got "${value}"`);
  if (opts.host && !opts.host.some((h) => value.startsWith(h))) {
    fail(`${path} must start with ${opts.host.join(" or ")}, got "${value}"`);
  }
  if (/example\.com|placeholder|TODO|TBD/i.test(value)) fail(`${path} still holds a placeholder: "${value}"`);
};

urlField("signup.formUrl", cfg.signup?.formUrl, { host: ["https://docs.google.com/forms/", "https://forms.gle/"] });
urlField("discord.inviteUrl", cfg.discord?.inviteUrl, { host: ["https://discord.gg/", "https://discord.com/invite/"] });
urlField("play.optInUrl", cfg.play?.optInUrl, { host: ["https://play.google.com/"] });
urlField("play.listingUrl", cfg.play?.listingUrl, { host: ["https://play.google.com/"] });

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.signup?.email || "")) fail("signup.email must be an email address");

/* Google's engagement review looks for exactly the kind of tester farming these
   words describe. They must never appear in a URL we publish. */
if (/emulator|tester[- ]?swap|exchange/i.test(JSON.stringify(cfg))) {
  fail("program.json mentions emulators or tester swapping — recruit real players only");
}

if (problems.length) {
  console.error("\n  brushpass/program.json is not publishable:\n");
  for (const p of problems) console.error("   ✕ " + p);
  console.error("\n  Nothing was written. Fix program.json and build again.\n");
  process.exit(1);
}

/* ---------- derived values ---------- */

const stageLabel = {
  "closed-testing": "Closed alpha",
  "open-testing": "Open beta",
  "production": "Available now"
}[cfg.stage];

const mailto =
  `mailto:${cfg.signup.email}?subject=${encodeURIComponent(cfg.signup.emailSubject || "Brush Pass playtest volunteer")}`;

const data = {
  ...cfg,
  stageLabel,
  signup: { ...cfg.signup, mailto }
};

const CONDITION = {
  signupForm: isHttps(cfg.signup?.formUrl),
  discord: isHttps(cfg.discord?.inviteUrl),
  playOptIn: isHttps(cfg.play?.optInUrl),
  playListing: isHttps(cfg.play?.listingUrl),
  closedTesting: cfg.stage === "closed-testing",
  openTesting: cfg.stage === "open-testing",
  production: cfg.stage === "production"
};

const HREF = {
  signupForm: CONDITION.signupForm ? cfg.signup.formUrl : "",
  discord: CONDITION.discord ? cfg.discord.inviteUrl : "",
  playOptIn: CONDITION.playOptIn ? cfg.play.optInUrl : "",
  playListing: CONDITION.playListing ? cfg.play.listingUrl : "",
  email: mailto
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dig = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

const stripHidden = (attrs) => attrs.replace(/\shidden(="[^"]*")?(?=\s|$)/g, "");

const RE_VAL = /<([a-z]+)([^>]*\sdata-bp="([a-zA-Z0-9._-]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_HREF = /<a([^>]*\sdata-bp-href="(signupForm|discord|playOptIn|playListing|email)"[^>]*)>/g;
const RE_WHEN = new RegExp(`<([a-z]+)([^>]*\\sdata-bp-when="(${Object.keys(CONDITION).join("|")})(:not)?"[^>]*)>`, "g");

function apply(html) {
  let out = html;

  out = out.replace(RE_VAL, (m, tag, attrs, key) => {
    const raw = dig(data, key);
    const value = raw === undefined || raw === null ? "" : escapeHtml(raw);
    return `<${tag}${attrs}>${value}</${tag}>`;
  });

  out = out.replace(RE_HREF, (m, attrs, kind) => {
    const href = HREF[kind];
    let a = attrs.replace(/\shref="[^"]*"/, "");
    /* No destination yet: hide the control rather than leave it pointing nowhere.
       A data-bp-when on the same element wins, so authors can pair the two. */
    if (!/\sdata-bp-when=/.test(a)) {
      a = stripHidden(a) + (href ? "" : " hidden");
    }
    return `<a${a} href="${escapeHtml(href || HREF.email)}">`;
  });

  out = out.replace(RE_WHEN, (m, tag, attrs, name, not) => {
    const show = not ? !CONDITION[name] : CONDITION[name];
    const clean = stripHidden(attrs);
    return `<${tag}${show ? clean : clean + " hidden"}>`;
  });

  return out;
}

/* ---------- run ---------- */

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".html")) yield full;
  }
}

let changed = 0, checked = 0;
for await (const file of walk(DIR)) {
  const before = await readFile(file, "utf8");
  const after = apply(before);
  checked++;
  if (after !== before) {
    await writeFile(file, after, "utf8");
    changed++;
    console.log("  updated  " + relative(ROOT, file));
  }
}

console.log(
  `  brush pass: stage ${cfg.stage}, sign-up form ${CONDITION.signupForm ? "live" : "not set — email route shown"}, ` +
  `discord ${CONDITION.discord ? "live" : "not set"}, ` +
  `play opt-in ${CONDITION.playOptIn ? "live" : "not set"}; ${checked} page(s) checked, ${changed} updated`
);
