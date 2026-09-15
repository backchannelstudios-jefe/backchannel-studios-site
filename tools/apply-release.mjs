#!/usr/bin/env node
/* ============================================================
   apply-release.mjs
   ------------------------------------------------------------
   Turns nerve/release.json into the published site, so nothing
   about a release is ever maintained in two places.

   Vercel runs this on every deploy via `npm run build`.

   WHAT IT DERIVES FOR EACH RELEASE (never type these by hand):

     • sha256        hashed from the ZIP actually in the repo
     • bytes         its real byte length
     • sizeLabel     e.g. "1.23 MB"
     • url           from its path, so link and file agree
     • checksumUrl   the .sha256 beside it
     • filename      from its path
     • the .sha256 sidecar written next to the ZIP
     • versionLabel  "0.68.7 (alpha)"
     • match         "current" | "staged" | "previous"
     • statusLabel   what the card's pill says
     • warning       the compatibility line, or "" when none applies

   Because every digest is taken from the same bytes Vercel
   serves, a published checksum cannot disagree with its file.

   THE VERSION-MATCH RULE. Nerve's extension and companion must be
   the same version. `forgeExtensionVersion` — the version the Forge
   listing delivers right now — decides every card's wording:

     version = forgeExtensionVersion  → the Forge match
     version > forgeExtensionVersion  → staged, "don't install yet"
     version < forgeExtensionVersion  → rollback archive, "don't mix"

   Moving that one string on Forge release day relabels every card
   and swaps every warning. No HTML is edited to ship a release.

   WHAT IT REWRITES IN THE HTML:

     Site-wide:
       <tag data-rel="dotted.key">…</tag>
           → the value, with a sensible fallback when still unknown
       <tag data-rel-link="companion|checksum|forge|forum|support">…</tag>
           → REPLACED by a generated <a> when the target exists, else by
             a non-clickable disabled control. A placeholder link is never
             clickable. Contents are discarded, so use it only for buttons.
             data-rel-variant="primary|secondary|ghost|bare" picks the look.
       <a data-rel-href="companion|checksum|forge|forum|support">…</a>
           → only the href is rewritten; contents are left as authored.
       <span data-rel-status="companion|forge">…</span>   → status pill
       <p   data-rel-note="companion|forge">…</p>         → hidden once live
       <tag data-rel-when="<condition>[:not]">…</tag>
           → `hidden` toggled by that condition. Conditions: companion,
             forge, forum, feedbackForm, forgeInstallVerified,
             stagedRelease, multipleReleases

     Inside a release card — <article data-rel-release="0.68.7"> … </article>:
       <tag data-rel-field="key">…</tag>       → that release's value.
                                                 Empty value ⇒ element hidden.
       <a   data-rel-field-href="key">         → href only
       <a   data-rel-field-download="key">     → download attribute only

     "companion" site-wide means THE RECOMMENDED RELEASE — the one that
     pairs with the extension Forge serves today — so the hero button
     always offers the download that actually works right now.

   The committed HTML always carries the current values, so pages are
   correct even if this never runs. Running it twice is a no-op.
   ============================================================ */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/* Matched against the path from the repo root, NOT the bare directory name —
   otherwise nerve/downloads/ would be skipped along with the top-level downloads/. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "tools", "assets", "downloads"]);

const rel = JSON.parse(await readFile(join(ROOT, "nerve", "release.json"), "utf8"));

const problems = [];
const isHttps = (u) => typeof u === "string" && /^https:\/\/\S+$/.test(u);
const fail = (m) => problems.push(m);

if (!rel.channel) fail("channel is required");
if (!rel.forgeExtensionVersion) fail("forgeExtensionVersion is required — it decides what every release card says");
if (!Array.isArray(rel.releases) || rel.releases.length === 0) fail("releases must be a non-empty array");

/* ---------- version comparison ----------
   Plain dotted numbers. 0.68.7 vs 0.67.1 must not be compared as strings:
   "0.68.7" < "0.7.0" lexically, which would silently mislabel every card. */
function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function humanSize(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

/* ---------- resolve every release from disk ---------- */

const releases = [];
const seen = new Set();

for (const entry of rel.releases || []) {
  const r = { ...entry };
  const where = `releases["${r.version || "?"}"]`;

  if (!r.version) { fail(`${where}: version is required`); continue; }
  if (seen.has(r.version)) { fail(`${where}: listed twice`); continue; }
  seen.add(r.version);
  if (!/^\d+(\.\d+)*$/.test(r.version)) fail(`${where}: version must be dotted numbers, got "${r.version}"`);

  if (r.status && !["pending", "available"].includes(r.status)) {
    fail(`${where}: status must be "pending" or "available", got "${r.status}"`);
  }

  r.channel = r.channel || rel.channel;
  r.versionLabel = `${r.version} (${r.channel})`;
  r.releaseDateLabel = r.releaseDate ? formatDate(r.releaseDate) : "";
  r.fguAnnouncement = `Nerve Adapter v${r.version} loaded.`;
  r.adapterString = `Nerve Adapter v${r.version}`;
  r.improvements = Array.isArray(r.improvements) ? r.improvements : [];
  /* Empty for a release with nothing listed, so the heading hides with its list. */
  r.improvementsTitle = r.improvements.length ? "What improved in this release" : "";

  if (r.status === "available") {
    if (!r.path) {
      fail(`${where}: status is "available" but path is empty — point it at the ZIP in downloads/`);
    } else if (r.path.includes("..") || r.path.startsWith("/")) {
      fail(`${where}: path must be repo-relative, got "${r.path}"`);
    } else {
      let bytes;
      const abs = join(ROOT, r.path);
      try {
        bytes = await readFile(abs);
      } catch {
        fail(`${where}: path points at a file that is not in the repo: ${r.path}`);
      }

      if (bytes) {
        r.filename = basename(r.path);
        r.bytes = bytes.length;
        r.sizeLabel = humanSize(bytes.length);
        r.sha256 = createHash("sha256").update(bytes).digest("hex");
        r.url = "/" + r.path.split("/").map(encodeURIComponent).join("/");
        r.checksumUrl = r.url + ".sha256";
        r.checksumFilename = r.filename + ".sha256";
        /* The version belongs in the label: with two downloads on the page, a button
           that just says "Download Windows companion" is the mistake waiting to happen. */
        r.downloadLabel = `Download companion ${r.version} (${r.sizeLabel})`;

        /* Guard against the classic mistake: new ZIP, forgotten version bump. */
        if (!r.filename.includes(r.version)) {
          fail(`${where}: version does not appear in the filename "${r.filename}" — one of the two is stale`);
        }
        if (!r.releaseDate) fail(`${where}: status is "available" but releaseDate is empty`);

        /* Write the sidecar in the standard `sha256sum` format. */
        const sidecar = `${r.sha256}  ${r.filename}\n`;
        const sidecarPath = abs + ".sha256";
        /* Compare on content, not line endings: a CRLF checkout must not look
           like a change, or every fresh clone on Windows reports a dirty file. */
        const existing = await readFile(sidecarPath, "utf8").catch(() => null);
        const same = existing !== null &&
          existing.replace(/\r\n/g, "\n") === sidecar.replace(/\r\n/g, "\n");
        if (!same) {
          await writeFile(sidecarPath, sidecar, "utf8");
          console.log("  wrote    " + relative(ROOT, sidecarPath));
        }
      }
    }
  }

  releases.push(r);
}

/* Newest first, whatever order they were written in. */
releases.sort((a, b) => cmpVersion(b.version, a.version));

/* ---------- match each release against what Forge actually serves ---------- */

const forgeVersion = rel.forgeExtensionVersion;
const newest = releases[0];

for (const r of releases) {
  const c = cmpVersion(r.version, forgeVersion);
  r.match = c === 0 ? "current" : c > 0 ? "staged" : "previous";

  if (r.match === "current") {
    /* Both true at once only when nothing newer is staged. */
    r.statusLabel = r === newest ? "Current / recommended" : "Current Forge match";
    r.warning = "";
  } else if (r.match === "staged") {
    r.statusLabel = `Available for the upcoming Forge ${r.version} update`;
    r.warning = `Do not install this companion until Fantasy Grounds reports Nerve Adapter v${r.version}.`;
  } else {
    r.statusLabel = "Previous version / rollback archive";
    r.warning = `Requires the matching ${r.version} Fantasy Grounds extension. Do not mix versions.`;
  }
}

/* The download a visitor should actually take today is the one that pairs with
   the extension they can actually install. If nothing in the list matches what
   Forge serves, every visitor following the site would end up with a mismatched
   pair — so that is a build failure, not a warning. It is also what stops anyone
   deleting the old companion while the Forge listing still needs it. */
const recommended = releases.find((r) => r.match === "current");
if (!recommended && releases.length) {
  fail(
    `no listed release matches forgeExtensionVersion "${forgeVersion}" — ` +
    `the Forge extension has no companion to pair with. Keep that release listed, ` +
    `or correct forgeExtensionVersion.`
  );
}

if (problems.length) {
  console.error("\n  nerve/release.json is not publishable:\n");
  for (const p of problems) console.error("   ✕ " + p);
  console.error("\n  Nothing was written. Fix release.json and build again.");
  console.error("  The previous deployment keeps serving until this passes.\n");
  process.exit(1);
}

const staged = releases.filter((r) => r.match === "staged");

/* ---------- derived, site-wide values ----------
   "companion" everywhere outside a release card means the recommended download.
   The runtime and the extension both report a bare "0.67.1"; "alpha" is the
   release channel and the file-label suffix. Never tell a tester to expect the
   channel suffix in what Fantasy Grounds prints. */

const companion = { ...recommended };

const data = {
  ...rel,
  companion,
  releases,
  version: recommended.version,
  releaseDate: recommended.releaseDate,
  extensionVersion: forgeVersion,
  versionLabel: recommended.versionLabel,
  extensionVersionLabel: `${forgeVersion} (${rel.channel})`,
  fguAnnouncement: `Nerve Adapter v${forgeVersion} loaded.`,
  releaseDateLabel: recommended.releaseDateLabel,
  stagedVersion: staged[0]?.version || "",
  stagedVersionLabel: staged[0]?.versionLabel || "",
  stagedReleaseDateLabel: staged[0]?.releaseDateLabel || "",
  newestVersion: newest.version
};

/* ---------- value resolution ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dig = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

const FALLBACK = {
  "companion.sizeLabel": '<span class="pending">— pending publication</span>',
  "companion.sha256": "published with the release",
  releaseDateLabel: "not yet published"
};

function valueFor(key) {
  const raw = dig(data, key);
  if (raw === undefined || raw === null || raw === "") return FALLBACK[key] ?? "";
  return escapeHtml(raw);
}

/* ---------- conditions ---------- */

const companionReady = companion.status === "available" && !!companion.url;
const checksumReady = companionReady && !!companion.checksumUrl;
const forgeReady = rel.forge?.status === "available" && isHttps(rel.forge?.url);
const feedbackFormReady = rel.feedback?.formEnabled === true;
const forumReady = isHttps(rel.community?.forumUrl);
/* Publishing on the Forge is not the same as having tested installation from it. */
const forgeInstallVerified = forgeReady && rel.forge?.installVerified === true;

const CONDITION = {
  companion: companionReady,
  forge: forgeReady,
  forum: forumReady,
  feedbackForm: feedbackFormReady,
  forgeInstallVerified,
  /* A newer companion is published here but Forge has not caught up yet. */
  stagedRelease: staged.length > 0,
  multipleReleases: releases.length > 1
};

/* ---------- link rendering ---------- */

/* A placeholder may carry data-rel-variant="primary|secondary|ghost|bare" to choose how
   the generated control looks, so the same link can lead a page or sit in a list. */
function variantOf(attrs, fallback) {
  const m = /\sdata-rel-variant="(primary|secondary|ghost|bare)"/.exec(attrs || "");
  return m ? m[1] : fallback;
}
const classFor = (v) =>
  v === "bare" ? "" :
  v === "ghost" ? 'class="btn btn-ghost" ' :
  v === "primary" ? 'class="btn btn-primary" ' : 'class="btn btn-secondary" ';

function renderLink(kind, attrs) {
  const variantAttr = (a) => {
    const m = /\sdata-rel-variant="[^"]*"/.exec(a || "");
    return m ? m[0] : "";
  };
  const disabled = (label) =>
    `<span class="btn-disabled" data-rel-link="${kind}"${variantAttr(attrs)}>${escapeHtml(label)}</span>`;
  const v = (fallback) => classFor(variantOf(attrs, fallback));

  switch (kind) {
    case "companion":
      if (!companionReady) return disabled(rel.companion?.pendingLabel || "Companion download pending approval");
      return (
        `<a ${v("secondary")}data-rel-link="companion"${variantAttr(attrs)} href="${escapeHtml(companion.url)}" ` +
        `download="${escapeHtml(companion.filename)}" type="application/zip">` +
        `Download Windows Companion ${escapeHtml(companion.version)} (${escapeHtml(companion.sizeLabel)})</a>`
      );

    case "checksum":
      if (!checksumReady) return disabled("Checksum published with the release");
      return (
        `<a ${v("secondary")}data-rel-link="checksum"${variantAttr(attrs)} href="${escapeHtml(companion.checksumUrl)}" ` +
        `download="${escapeHtml(companion.filename)}.sha256">Download the .sha256 file</a>`
      );

    case "forge":
      if (!forgeReady) return disabled(rel.forge?.pendingLabel || "Forge release pending");
      return (
        `<a ${v("primary")}data-rel-link="forge"${variantAttr(attrs)} href="${escapeHtml(rel.forge.url)}" ` +
        `target="_blank" rel="noopener noreferrer">Get Nerve on Forge ↗</a>`
      );

    case "forum":
      if (!forumReady) return disabled("Forum thread not published yet");
      return (
        `<a ${v("secondary")}data-rel-link="forum"${variantAttr(attrs)} href="${escapeHtml(rel.community.forumUrl)}" ` +
        `target="_blank" rel="noopener noreferrer">Discussion and bug reports ↗</a>`
      );

    case "support":
      if (!isHttps(rel.support?.url)) return disabled("Support options published with the listing");
      return (
        `<a ${v("ghost")}data-rel-link="support"${variantAttr(attrs)} href="${escapeHtml(rel.support.url)}" ` +
        `target="_blank" rel="noopener noreferrer">${escapeHtml(rel.support.label || "Support Nerve on Forge")} ↗</a>`
      );

    default:
      return null;
  }
}

function renderStatus(kind) {
  const ready = CONDITION[kind];
  const label = ready
    ? (kind === "companion" ? "Available now" : "Available on the Forge")
    : (kind === "companion" ? "Pending owner approval" : "Forge release pending");
  return `<span class="status status--${ready ? "available" : "pending"}" data-rel-status="${kind}">${escapeHtml(label)}</span>`;
}

/* ---------- rewriting ---------- */

const RE_REL = /<([a-z]+)([^>]*\sdata-rel="([a-zA-Z0-9._-]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_LINK = /<([a-z]+)([^>]*\sdata-rel-link="(companion|checksum|forge|forum|support)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_HREF = /<a([^>]*\sdata-rel-href="(companion|checksum|forge|forum|support)"[^>]*)>/g;

/* The live URL for each target, or "" when it is not published. */
const HREF = {
  companion: companionReady ? companion.url : "",
  checksum: checksumReady ? companion.checksumUrl : "",
  forge: forgeReady ? rel.forge.url : "",
  forum: forumReady ? rel.community.forumUrl : "",
  support: isHttps(rel.support?.url) ? rel.support.url : ""
};
const RE_STATUS = /<span([^>]*\sdata-rel-status="(companion|forge)"[^>]*)>([\s\S]*?)<\/span>/g;
const RE_NOTE = /<p([^>]*\sdata-rel-note="(companion|forge)"[^>]*)>/g;
const CONDITION_NAMES = Object.keys(CONDITION).join("|");
const RE_WHEN = new RegExp(`<([a-z]+)([^>]*\\sdata-rel-when="(${CONDITION_NAMES})(:not)?"[^>]*)>`, "g");

const stripHidden = (attrs) => attrs.replace(/\shidden(="[^"]*")?(?=\s|$)/g, "");

/* ---------- release cards ----------
   <article data-rel-release="0.68.7"> … </article> is filled from that release
   alone, so the two cards cannot pick up each other's checksum. Fields left with
   no value are hidden rather than emptied, which is how a card with no
   compatibility warning loses its warning line instead of showing a blank box. */

const RE_CARD_OPEN = /<([a-z]+)([^>]*\sdata-rel-release="([^"]+)"[^>]*)>/;

/* Find the end of the element opened at `openIdx`, counting nested same-name tags. */
function closeIndex(html, tag, afterOpen) {
  const re = new RegExp(`</?${tag}\\b`, "gi");
  re.lastIndex = afterOpen;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return html.length;
}

function fillCard(inner, r) {
  let out = inner;

  out = out.replace(/<([a-z]+)([^>]*\sdata-rel-field="([a-zA-Z0-9._-]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (_w, tag, attrs, key) => {
      const raw = dig(r, key);
      const value = raw === undefined || raw === null ? "" : String(raw);
      let a = stripHidden(attrs);
      /* Keep a status pill's colour in step with the state it is announcing, so a
         staged release can never be shown wearing the green "available" dot. */
      a = a.replace(/\sclass="([^"]*)"/, (whole, cls) =>
        /\bstatus--/.test(cls)
          ? ` class="${cls.replace(/\bstatus--[a-z]+\b/g, `status--${r.match}`)}"`
          : whole);
      /* An empty field is a field that does not apply to this release. */
      return value === ""
        ? `<${tag}${a} hidden></${tag}>`
        : `<${tag}${a}>${escapeHtml(value)}</${tag}>`;
    });

  /* The improvement list is written once, in release.json, and rendered here —
     so a card cannot drift from the release notes it is summarising. */
  out = out.replace(/<([a-z]+)([^>]*\sdata-rel-field-list="([a-zA-Z0-9._-]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (_w, tag, attrs, key) => {
      const items = dig(r, key);
      const a = stripHidden(attrs);
      if (!Array.isArray(items) || items.length === 0) return `<${tag}${a} hidden></${tag}>`;
      const lis = items.map((item) => {
        const [term, text] = Array.isArray(item) ? item : ["", item];
        return term
          ? `\n            <li><strong>${escapeHtml(term)}</strong> — ${escapeHtml(text)}</li>`
          : `\n            <li>${escapeHtml(text)}</li>`;
      }).join("");
      return `<${tag}${a}>${lis}\n          </${tag}>`;
    });

  out = out.replace(/<a([^>]*\sdata-rel-field-href="([a-zA-Z0-9._-]+)"[^>]*)>/g, (whole, attrs, key) => {
    const url = dig(r, key);
    if (!url) return whole;
    let a = attrs.replace(/\shref="[^"]*"/, ` href="${escapeHtml(url)}"`);
    /* The download that actually pairs with the installed extension is the one the
       eye should land on. With a staged build sitting above it on the page, leading
       with the wrong button is how someone ends up with a mismatched pair. */
    a = a.replace(/\sclass="([^"]*\bbtn-download\b[^"]*)"/, (_w, cls) =>
      ` class="${cls.replace(/\bbtn-(primary|secondary)\b/g, r.match === "current" ? "btn-primary" : "btn-secondary")}"`);
    return `<a${a}>`;
  });

  out = out.replace(/<a([^>]*\sdata-rel-field-download="([a-zA-Z0-9._-]+)"[^>]*)>/g, (whole, attrs, key) => {
    const name = dig(r, key);
    if (!name) return whole;
    return `<a${attrs.replace(/\sdownload="[^"]*"/, ` download="${escapeHtml(name)}"`)}>`;
  });

  /* Blocks that belong to one match state only: staged / previous / current. */
  out = out.replace(/<([a-z]+)([^>]*\sdata-rel-field-when="(current|staged|previous)(:not)?"[^>]*)>/g,
    (_w, tag, attrs, want, negated) => {
      const show = negated ? r.match !== want : r.match === want;
      return `<${tag}${stripHidden(attrs)}${show ? "" : " hidden"}>`;
    });

  return out;
}

function rewriteCards(html) {
  let out = "", rest = html;
  for (;;) {
    const m = RE_CARD_OPEN.exec(rest);
    if (!m) break;
    const [open, tag, , version] = m;
    const openEnd = m.index + open.length;
    const end = closeIndex(rest, tag, openEnd);
    const r = releases.find((x) => x.version === version);
    const inner = rest.slice(openEnd, end);
    out += rest.slice(0, openEnd) + (r ? fillCard(inner, r) : inner);
    rest = rest.slice(end);
  }
  return out + rest;
}

function rewrite(html) {
  let out = html;

  /* Cards first: their fields must not be touched by the site-wide rules. */
  out = rewriteCards(out);

  out = out.replace(RE_LINK, (_whole, _tag, attrs, kind) => renderLink(kind, attrs));

  /* href-only: keep the element and everything inside it, just repoint it. */
  out = out.replace(RE_HREF, (whole, attrs, kind) => {
    const url = HREF[kind];
    if (!url) return whole; /* not published — leave the page exactly as authored */
    return `<a${attrs.replace(/\shref="[^"]*"/, ` href="${escapeHtml(url)}"`)}>`;
  });

  out = out.replace(RE_STATUS, (_w, _a, kind) => renderStatus(kind));

  /* Hide rather than delete, so going back to pending restores the text. */
  out = out.replace(RE_NOTE, (_w, attrs, kind) =>
    `<p${stripHidden(attrs)}${CONDITION[kind] ? " hidden" : ""}>`);

  out = out.replace(RE_WHEN, (_w, tag, attrs, kind, negated) => {
    const show = negated ? !CONDITION[kind] : CONDITION[kind];
    return `<${tag}${stripHidden(attrs)}${show ? "" : " hidden"}>`;
  });

  out = out.replace(RE_REL, (whole, tag, attrs, key) => {
    const value = valueFor(key);
    if (value === "") return whole; /* unknown key: leave the page untouched */
    return `<${tag}${attrs}>${value}</${tag}>`;
  });

  return out;
}

/* ---------- walk ---------- */

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    const fromRoot = relative(ROOT, full).split("\\").join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(fromRoot)) continue;
      yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) yield full;
  }
}

let changed = 0, scanned = 0;
for await (const file of htmlFiles(ROOT)) {
  scanned++;
  const before = await readFile(file, "utf8");
  const after = rewrite(before);
  if (after !== before) {
    await writeFile(file, after, "utf8");
    changed++;
    console.log("  updated  " + relative(ROOT, file));
  }
}

const pad = (s) => String(s).padEnd(18);
console.log(
  `\n  Nerve — ${scanned} page(s) scanned, ${changed} rewritten.\n` +
  `  ${pad("forge extension:")}${forgeVersion}  (what the listing delivers today)\n` +
  `  ${pad("recommended:")}${recommended.versionLabel}\n` +
  releases.map((r) =>
    `    ${r.version.padEnd(8)} ${r.match.padEnd(9)} ` +
    (r.status === "available"
      ? `${r.sizeLabel.padStart(8)}  ${r.sha256.slice(0, 16)}…  ${r.statusLabel}`
      : `pending (no clickable link rendered)`)
  ).join("\n") + "\n" +
  `  ${pad("forge:")}${forgeReady ? "PUBLISHED  " + rel.forge.url : "pending (no clickable link rendered)"}\n` +
  `  ${pad("forge install:")}${forgeInstallVerified ? "verified" : "NOT yet tested end to end — site says so"}\n` +
  `  ${pad("forum:")}${forumReady ? rel.community.forumUrl : "not set"}\n` +
  `  ${pad("support:")}${isHttps(rel.support?.url) ? rel.support.url : "not set"}\n` +
  `  ${pad("feedback form:")}${feedbackFormReady ? "enabled" : "hidden (email route shown instead)"}\n`
);
