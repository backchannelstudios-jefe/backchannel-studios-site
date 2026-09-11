#!/usr/bin/env node
/* ============================================================
   apply-release.mjs
   ------------------------------------------------------------
   Turns nerve/release.json into the published site, so nothing
   about a release is ever maintained in two places.

   Vercel runs this on every deploy via `npm run build`.

   WHAT IT DERIVES FOR YOU (never type these by hand):

     • companion.sha256      hashed from the ZIP actually in the repo
     • companion.bytes       its real byte length
     • companion.sizeLabel   e.g. "1.19 MB"
     • companion.url         from its path, so link and file agree
     • companion.filename    from its path
     • the .sha256 sidecar   written next to the ZIP
     • versionLabel          "0.67.1 (alpha)"
     • fguAnnouncement       "Nerve Adapter v0.67.1 loaded."

   Because the digest is taken from the same bytes Vercel serves,
   the published checksum cannot disagree with the published file.

   WHAT IT REWRITES IN THE HTML:

     <tag data-rel="dotted.key">…</tag>
         → the value, with a sensible fallback when still unknown

     <tag data-rel-link="companion|checksum|forge|donate">…</tag>
         → a real <a> only when the target exists and is approved;
           otherwise a non-clickable disabled control. A placeholder
           link is never rendered as clickable.

     <span data-rel-status="companion|forge">…</span>   → status pill
     <p   data-rel-note="companion|forge">…</p>         → hidden once live
     <tag data-rel-when="companion|forge|feedbackForm[:not]">…</tag>
         → `hidden` toggled on the whole element by that condition

   The committed HTML always carries the current values, so pages
   are correct even if this never runs. Running it twice is a no-op.
   ============================================================ */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
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

if (!rel.version) fail("version is required");
if (!rel.channel) fail("channel is required");

/* ---------- resolve the companion artifact from disk ---------- */

let companion = { ...rel.companion };

if (companion.status === "available") {
  if (!companion.path) {
    fail("companion.status is 'available' but companion.path is empty — point it at the ZIP in downloads/");
  } else if (companion.path.includes("..") || companion.path.startsWith("/")) {
    fail(`companion.path must be a repo-relative path, got "${companion.path}"`);
  } else {
    const abs = join(ROOT, companion.path);
    let bytes;
    try {
      bytes = await readFile(abs);
    } catch {
      fail(`companion.path points at a file that is not in the repo: ${companion.path}`);
    }

    if (bytes) {
      companion.filename = basename(companion.path);
      companion.bytes = bytes.length;
      companion.sizeLabel = humanSize(bytes.length);
      companion.sha256 = createHash("sha256").update(bytes).digest("hex");
      companion.url = "/" + companion.path.split("/").map(encodeURIComponent).join("/");
      companion.checksumUrl = companion.url + ".sha256";

      /* Guard against the classic mistake: new ZIP, forgotten version bump. */
      if (!companion.filename.includes(rel.version)) {
        fail(
          `version "${rel.version}" does not appear in the companion filename ` +
          `"${companion.filename}" — one of the two is stale`
        );
      }
      if (!rel.releaseDate) fail("companion.status is 'available' but releaseDate is empty");

      /* Write the sidecar in the standard `sha256sum` format. */
      const sidecar = `${companion.sha256}  ${companion.filename}\n`;
      const sidecarPath = abs + ".sha256";
      const existing = await readFile(sidecarPath, "utf8").catch(() => null);
      if (existing !== sidecar) {
        await writeFile(sidecarPath, sidecar, "utf8");
        console.log("  wrote    " + relative(ROOT, sidecarPath));
      }
    }
  }
}

if (rel.forge?.status === "available" && !isHttps(rel.forge.url)) {
  fail("forge.status is 'available' but forge.url is not an https:// URL");
}
for (const [name, obj] of [["companion", rel.companion], ["forge", rel.forge]]) {
  if (obj?.status && !["pending", "available"].includes(obj.status)) {
    fail(`${name}.status must be "pending" or "available", got "${obj.status}"`);
  }
}

if (problems.length) {
  console.error("\n  nerve/release.json is not publishable:\n");
  for (const p of problems) console.error("   ✕ " + p);
  console.error("\n  Nothing was written. Fix release.json and build again.");
  console.error("  The previous deployment keeps serving until this passes.\n");
  process.exit(1);
}

function humanSize(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- derived, human-facing labels ----------
   The runtime and the extension both report a bare "0.67.1"; "alpha" is the
   release channel and the file-label suffix. Never tell a tester to expect
   the channel suffix in what Fantasy Grounds prints. */

const data = {
  ...rel,
  companion,
  versionLabel: `${rel.version} (${rel.channel})`,
  extensionVersionLabel: `${rel.extensionVersion || rel.version} (${rel.channel})`,
  fguAnnouncement: `Nerve Adapter v${rel.extensionVersion || rel.version} loaded.`,
  releaseDateLabel: rel.releaseDate ? formatDate(rel.releaseDate) : ""
};

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

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

const CONDITION = {
  companion: companionReady,
  forge: forgeReady,
  feedbackForm: feedbackFormReady
};

/* ---------- link rendering ---------- */

function renderLink(kind) {
  const disabled = (label) => `<span class="btn-disabled" data-rel-link="${kind}">${escapeHtml(label)}</span>`;

  switch (kind) {
    case "companion":
      if (!companionReady) return disabled(rel.companion?.pendingLabel || "Companion download pending approval");
      return (
        `<a class="btn btn-primary" data-rel-link="companion" href="${escapeHtml(companion.url)}" ` +
        `download="${escapeHtml(companion.filename)}" type="application/zip">` +
        `Download for Windows (${escapeHtml(companion.sizeLabel)})</a>`
      );

    case "checksum":
      if (!checksumReady) return disabled("Checksum published with the release");
      return (
        `<a class="btn btn-secondary" data-rel-link="checksum" href="${escapeHtml(companion.checksumUrl)}" ` +
        `download="${escapeHtml(companion.filename)}.sha256">Download the .sha256 file</a>`
      );

    case "forge":
      if (!forgeReady) return disabled(rel.forge?.pendingLabel || "Forge release pending");
      return (
        `<a class="btn btn-secondary" data-rel-link="forge" href="${escapeHtml(rel.forge.url)}" ` +
        `target="_blank" rel="noopener noreferrer">Get the extension on the Forge ↗</a>`
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
const RE_LINK = /<([a-z]+)([^>]*\sdata-rel-link="(companion|checksum|forge|donate)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_STATUS = /<span([^>]*\sdata-rel-status="(companion|forge)"[^>]*)>([\s\S]*?)<\/span>/g;
const RE_NOTE = /<p([^>]*\sdata-rel-note="(companion|forge)"[^>]*)>/g;
const RE_WHEN = /<([a-z]+)([^>]*\sdata-rel-when="(companion|forge|feedbackForm)(:not)?"[^>]*)>/g;

const stripHidden = (attrs) => attrs.replace(/\shidden(="[^"]*")?(?=\s|$)/g, "");

function rewrite(html) {
  let out = html;

  out = out.replace(RE_LINK, (whole, tag, attrs, kind, inner) => {
    if (kind === "donate") {
      const url = rel.support?.donateUrl || "";
      if (!isHttps(url)) return whole;
      return `<${tag}${attrs.replace(/\shref="[^"]*"/, ` href="${escapeHtml(url)}"`)}>${inner}</${tag}>`;
    }
    return renderLink(kind);
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

console.log(
  `\n  Nerve ${data.versionLabel} — ${scanned} page(s) scanned, ${changed} rewritten.\n` +
  `  companion:     ${companionReady ? `PUBLISHED  ${companion.filename}  ${companion.sizeLabel}` : "pending (no clickable link rendered)"}\n` +
  (companionReady ? `  sha256:        ${companion.sha256}\n` : "") +
  `  forge:         ${forgeReady ? "published" : "pending (no clickable link rendered)"}\n` +
  `  feedback form: ${feedbackFormReady ? "enabled" : "hidden (email route shown instead)"}\n`
);
