#!/usr/bin/env node
/* ============================================================
   apply-release.mjs
   ------------------------------------------------------------
   Stamps the values in nerve/release.json into every HTML page,
   so no version number, filename, checksum or download link is
   ever hand-maintained in more than one place.

   Vercel runs this automatically via `npm run build`. You can
   also run it locally with `npm run build` before committing.

   It rewrites, in place:

     <tag data-rel="dotted.key">…</tag>
         → the value from release.json (with a sensible fallback
           when the value is still empty)

     <tag data-rel-link="companion|checksum|forge|donate">…</tag>
         → a real <a> when the artifact is approved AND has an
           https URL; otherwise a non-clickable disabled control.
           A placeholder link is never rendered as clickable.

     <span data-rel-status="companion|forge">…</span>
         → a status pill reflecting release.json

     <p data-rel-note="companion|forge">…</p>
         → hidden once that artifact is actually available, and
           shown again if it goes back to pending

   The committed HTML already carries the current values, so the
   pages are correct and viewable even if this script never runs.
   Running it twice in a row is a no-op.
   ============================================================ */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "tools", "assets"]);

/* ---------- load and validate the release record ---------- */

const rel = JSON.parse(await readFile(join(ROOT, "nerve", "release.json"), "utf8"));

const problems = [];
const isHttps = (u) => typeof u === "string" && /^https:\/\/\S+$/.test(u);

if (!rel.version) problems.push("version is required");

if (rel.companion?.status === "available") {
  if (!isHttps(rel.companion.url)) problems.push("companion.status is 'available' but companion.url is not an https:// URL");
  if (!/^[a-f0-9]{64}$/i.test(rel.companion.sha256 || "")) problems.push("companion.status is 'available' but companion.sha256 is not a 64-character hex digest");
  if (!isHttps(rel.companion.checksumUrl)) problems.push("companion.status is 'available' but companion.checksumUrl is not an https:// URL");
  if (!rel.companion.sizeLabel) problems.push("companion.status is 'available' but companion.sizeLabel is empty");
  if (!rel.releaseDate) problems.push("companion.status is 'available' but releaseDate is empty");
}
if (rel.forge?.status === "available" && !isHttps(rel.forge.url)) {
  problems.push("forge.status is 'available' but forge.url is not an https:// URL");
}
if (rel.companion?.status && !["pending", "available"].includes(rel.companion.status)) {
  problems.push(`companion.status must be "pending" or "available", got "${rel.companion.status}"`);
}
if (rel.forge?.status && !["pending", "available"].includes(rel.forge.status)) {
  problems.push(`forge.status must be "pending" or "available", got "${rel.forge.status}"`);
}

if (problems.length) {
  console.error("\n  nerve/release.json is not publishable:\n");
  for (const p of problems) console.error("   ✕ " + p);
  console.error("\n  Nothing was written. Fix release.json and build again.\n");
  process.exit(1);
}

/* ---------- value resolution ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dig = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

/* What to show when a value is legitimately not known yet. */
const FALLBACK = {
  "companion.sizeLabel": '<span class="pending">— pending publication</span>',
  "companion.sha256": "published with the release",
  releaseDateLabel: "not yet published"
};

function valueFor(key) {
  const raw = dig(rel, key);
  if (raw === undefined || raw === null || raw === "") {
    return FALLBACK[key] ?? "";
  }
  return escapeHtml(raw);
}

/* ---------- link rendering ---------- */

const companionReady = rel.companion?.status === "available" && isHttps(rel.companion?.url);
const checksumReady = companionReady && isHttps(rel.companion?.checksumUrl);
const forgeReady = rel.forge?.status === "available" && isHttps(rel.forge?.url);

function renderLink(kind) {
  const disabled = (label) => `<span class="btn-disabled" data-rel-link="${kind}">${escapeHtml(label)}</span>`;

  switch (kind) {
    case "companion":
      if (!companionReady) return disabled(rel.companion?.pendingLabel || "Companion download pending approval");
      return (
        `<a class="btn btn-primary" data-rel-link="companion" href="${escapeHtml(rel.companion.url)}" ` +
        `download="${escapeHtml(rel.companion.filename)}" type="application/zip">` +
        `Download Windows companion${rel.companion.sizeLabel ? " (" + escapeHtml(rel.companion.sizeLabel) + ")" : ""}</a>`
      );

    case "checksum":
      if (!checksumReady) return disabled("Checksum published with the release");
      return (
        `<a class="btn btn-secondary" data-rel-link="checksum" href="${escapeHtml(rel.companion.checksumUrl)}" ` +
        `download="${escapeHtml(rel.companion.filename)}.sha256">Download SHA-256 checksum</a>`
      );

    case "forge":
      if (!forgeReady) return disabled(rel.forge?.pendingLabel || "Forge release pending");
      return (
        `<a class="btn btn-secondary" data-rel-link="forge" href="${escapeHtml(rel.forge.url)}" ` +
        `target="_blank" rel="noopener noreferrer">Get the extension on the Forge ↗</a>`
      );

    default:
      return null; /* handled separately */
  }
}

function renderStatus(kind) {
  const ready = kind === "companion" ? companionReady : forgeReady;
  const label = ready
    ? "Available"
    : kind === "companion"
      ? "Pending owner approval"
      : "Forge release pending";
  return `<span class="status status--${ready ? "available" : "pending"}" data-rel-status="${kind}">${escapeHtml(label)}</span>`;
}

/* ---------- rewriting ---------- */

const RE_REL = /<([a-z]+)([^>]*\sdata-rel="([a-zA-Z0-9._-]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_LINK = /<([a-z]+)([^>]*\sdata-rel-link="(companion|checksum|forge|donate)"[^>]*)>([\s\S]*?)<\/\1>/g;
const RE_STATUS = /<span([^>]*\sdata-rel-status="(companion|forge)"[^>]*)>([\s\S]*?)<\/span>/g;
const RE_NOTE = /<p([^>]*\sdata-rel-note="(companion|forge)"[^>]*)>/g;

function rewrite(html) {
  let out = html;

  out = out.replace(RE_LINK, (whole, tag, attrs, kind, inner) => {
    if (kind === "donate") {
      const url = rel.support?.donateUrl || "";
      if (!isHttps(url)) return whole;
      const next = attrs.replace(/\shref="[^"]*"/, ` href="${escapeHtml(url)}"`);
      return `<${tag}${next}>${inner}</${tag}>`;
    }
    return renderLink(kind);
  });

  out = out.replace(RE_STATUS, (_whole, _attrs, kind) => renderStatus(kind));

  /* Hide rather than delete, so flipping a release back to pending
     restores the explanation instead of losing it permanently. */
  out = out.replace(RE_NOTE, (_whole, attrs, kind) => {
    const ready = kind === "companion" ? companionReady : forgeReady;
    const bare = attrs.replace(/\shidden(?==|\b)(="[^"]*")?/g, "");
    return `<p${bare}${ready ? " hidden" : ""}>`;
  });

  out = out.replace(RE_REL, (whole, tag, attrs, key, inner) => {
    const value = valueFor(key);
    if (value === "") return whole; /* unknown key: leave the page untouched */
    return `<${tag}${attrs}>${value}</${tag}>`;
  });

  return out;
}

/* ---------- walk ---------- */

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

let changed = 0;
let scanned = 0;

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
  `\n  Release ${rel.version} applied — ${scanned} page(s) scanned, ${changed} rewritten.\n` +
  `  companion: ${companionReady ? "published" : "PENDING (no clickable link rendered)"}\n` +
  `  forge:     ${forgeReady ? "published" : "PENDING (no clickable link rendered)"}\n`
);
