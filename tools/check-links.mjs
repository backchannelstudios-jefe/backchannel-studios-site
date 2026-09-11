#!/usr/bin/env node
/* ============================================================
   check-links.mjs — pre-publication checks.

   Run with `npm run check`. Verifies, across every HTML page:

   * every internal link resolves to a file that exists once the
     site is deployed with cleanUrls + trailingSlash:false
   * every referenced asset exists on disk
   * every same-page #anchor has a matching id
   * no placeholder download link is clickable
   * no prohibited claim wording has crept into the copy
   * every page has a title, description, canonical, favicon,
     skip link and a single <h1>

   Exits non-zero if anything fails, so it can gate a deploy.
   ============================================================ */

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".vercel", "tools", "drafts"]);

const failures = [];
const warnings = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

/* Claims the requirements explicitly forbid. */
const FORBIDDEN = [
  [/guaranteed\s+(response|reply)/i, "implies a guaranteed response time"],
  [/works?\s+with\s+(any|all|every)\s+(ai\s+)?provider/i, "implies universal provider compatibility"],
  [/(fully|completely)\s+automat(es|ed)\s+the\s+rules/i, "implies complete rules automation"],
  [/complete\s+rules\s+automation/i, "implies complete rules automation"],
  [/\bendorsed by\b(?![^.]*has not)/i, "endorsement claim"],
  [/officially\s+(certified|supported)\s+by\s+smiteworks/i, "SmiteWorks endorsement claim"],
  [/lifetime\s+access/i, "promises lifetime access"],
  [/tax[- ]deductible/i, "claims tax deductibility"],
  [/premium\s+support/i, "promises a premium support tier"],
  [/(never|does not)\s+leaves?\s+your\s+computer(?![^.]*not)/i, "claims data never leaves the computer"],
  [/\bfully\s+offline\b/i, "claims the product is offline"],
  [/replace(s|ment)?\s+(your|the)\s+(dm|gm|dungeon master|game master)\b(?![^.]*not)/i, "presents Nerve as a DM replacement"],
  [/buymeacoffee\.com\/(dashboard|home)/i, "uses the donation dashboard URL instead of the public link"]
];

/* ---------- collect files ---------- */
async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const allFiles = [];
for await (const f of walk(ROOT)) allFiles.push(relative(ROOT, f).split("\\").join("/"));
const fileSet = new Set(allFiles);
const pages = allFiles.filter((f) => f.endsWith(".html"));

/* Map a site URL path to the file it will serve. */
function resolves(urlPath) {
  const p = urlPath.replace(/^\//, "");
  if (p === "" ) return fileSet.has("index.html");
  if (fileSet.has(p)) return true;
  if (fileSet.has(p + ".html")) return true;          /* cleanUrls */
  if (fileSet.has(p + "/index.html")) return true;    /* directory index */
  if (p.startsWith("api/")) return fileSet.has(p + ".js");
  return false;
}

/* ---------- per-page checks ---------- */
for (const page of pages) {
  const html = await readFile(join(ROOT, page), "utf8");

  /* head essentials */
  if (!/<title>[^<]{5,}<\/title>/.test(html)) fail(page, "missing a <title>");
  if (!/<meta\s+name="description"\s+content="[^"]{20,}"/.test(html)) fail(page, "missing a meta description");
  if (!/<link\s+rel="canonical"/.test(html)) fail(page, "missing a canonical link");
  if (!/<link\s+rel="icon"\s+href="\/favicon\.ico"/.test(html)) fail(page, "missing the favicon link");
  if (!/class="skip-link"/.test(html)) fail(page, "missing the skip-to-content link");
  if (!/<html\s+lang="/.test(html)) fail(page, "missing lang on <html>");

  const h1s = html.match(/<h1[\s>]/g) || [];
  if (h1s.length !== 1) fail(page, `expected exactly one <h1>, found ${h1s.length}`);

  /* images need alt and intrinsic size */
  for (const [, tag] of html.matchAll(/<img\s([^>]*)>/g)) {
    if (!/\salt=/.test(tag)) fail(page, `an <img> has no alt attribute: ${tag.slice(0, 70)}`);
    if (!/\swidth=/.test(tag) || !/\sheight=/.test(tag)) warn(page, `an <img> has no width/height: ${tag.slice(0, 70)}`);
  }

  /* ids present on this page, for anchor checking */
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  /* links and asset references */
  const refs = [
    ...[...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) =>
      m[1].split(",").map((part) => part.trim().split(/\s+/)[0])
    )
  ];

  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|#)/.test(ref)) {
      if (ref.startsWith("#") && ref.length > 1 && !ids.has(ref.slice(1))) {
        fail(page, `anchor ${ref} has no matching id on this page`);
      }
      continue;
    }
    if (!ref.startsWith("/")) { warn(page, `relative reference "${ref}" — prefer a root-relative path`); continue; }

    const [path, hash] = ref.split("#");
    if (!resolves(path)) fail(page, `link "${ref}" does not resolve to a file`);
    else if (hash) {
      /* cross-page anchor: check the target page really has that id */
      const candidates = [path.replace(/^\//, ""), path.replace(/^\//, "") + ".html", path.replace(/^\//, "") + "/index.html"];
      const target = candidates.find((c) => fileSet.has(c));
      if (target && target.endsWith(".html")) {
        const targetHtml = await readFile(join(ROOT, target), "utf8");
        if (!new RegExp(`\\sid="${hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(targetHtml)) {
          fail(page, `anchor "${ref}" has no matching id in ${target}`);
        }
      }
    }
  }

  /* A download control may only be a real <a> when its target actually exists:
     either an absolute https:// URL, or a root-relative path served from this repo. */
  for (const [, tag] of html.matchAll(/<a\s([^>]*data-rel-link="[^"]*"[^>]*)>/g)) {
    const href = /(?:^|\s)href="([^"]*)"/.exec(tag)?.[1] ?? "";
    const isAbsolute = /^https:\/\/\S+$/.test(href);
    const isLocal = href.startsWith("/") && resolves(decodeURIComponent(href));
    if (!isAbsolute && !isLocal) {
      fail(page, `a download control links to "${href}", which is neither an https:// URL nor a file in this repo`);
    }
  }
  for (const [, tag] of html.matchAll(/<a\s([^>]*)>/g)) {
    const href = /(?:^|\s)href="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (href === "#" || href === "" || /\bTODO\b|\bTBD\b|example\.com|placeholder/i.test(href)) {
      fail(page, `placeholder link found: href="${href}"`);
    }
  }

  /* prohibited claims — check visible text only */
  const text = html
    /* Blocks marked data-claim-exempt state what we do NOT promise. Scanning them
       for the words they exist to disclaim produces nothing but false positives. */
    .replace(/<(\w+)[^>]*\sdata-claim-exempt[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  for (const [re, why] of FORBIDDEN) {
    const hit = re.exec(text);
    if (hit) fail(page, `prohibited claim (${why}): "${hit[0].trim()}"`);
  }
}

/* ---------- assets referenced by the manifest ---------- */
if (fileSet.has("site.webmanifest")) {
  const man = JSON.parse(await readFile(join(ROOT, "site.webmanifest"), "utf8"));
  for (const icon of man.icons || []) {
    if (!resolves(icon.src)) fail("site.webmanifest", `icon ${icon.src} does not exist`);
  }
}

/* ---------- the published checksum must match the published bytes ----------
   This is the check that matters most on this site: a download whose advertised
   digest does not match the served file is worse than no digest at all. */
{
  const rel = JSON.parse(await readFile(join(ROOT, "nerve", "release.json"), "utf8"));
  if (rel.companion?.status === "available") {
    const relPath = rel.companion.path || "";
    if (!fileSet.has(relPath)) {
      fail("nerve/release.json", `companion.path "${relPath}" is not a file in this repo`);
    } else {
      const bytes = await readFile(join(ROOT, relPath));
      const digest = createHash("sha256").update(bytes).digest("hex");

      const sidecarPath = relPath + ".sha256";
      if (!fileSet.has(sidecarPath)) {
        fail("nerve/release.json", `no .sha256 sidecar beside ${relPath} — run npm run build`);
      } else {
        const sidecar = (await readFile(join(ROOT, sidecarPath), "utf8")).trim().split(/\s+/)[0];
        if (sidecar !== digest) {
          fail(sidecarPath, `sidecar digest ${sidecar.slice(0, 16)}… does not match the file (${digest.slice(0, 16)}…)`);
        }
      }

      const dl = await readFile(join(ROOT, "nerve/downloads/index.html"), "utf8");
      const shown = /data-rel="companion\.sha256"[^>]*>([^<]*)</.exec(dl)?.[1]?.trim();
      if (shown !== digest) {
        fail("nerve/downloads/index.html", `the checksum shown to users (${shown}) does not match the actual file digest (${digest})`);
      }

      const size = /data-rel="companion\.sizeLabel"[^>]*>([^<]*)</.exec(dl)?.[1]?.trim();
      if (!size || /pending/i.test(size)) {
        fail("nerve/downloads/index.html", "the companion is published but no file size is shown");
      }
    }
  }
}

/* ---------- release record sanity ---------- */
const rel = JSON.parse(await readFile(join(ROOT, "nerve", "release.json"), "utf8"));
if (rel.support?.donateUrl !== "https://buymeacoffee.com/backchannelstudios") {
  fail("nerve/release.json", `donateUrl should be the public link, got "${rel.support?.donateUrl}"`);
}

/* ---------- report ---------- */
for (const w of warnings) console.log("  ⚠  " + w);
if (failures.length) {
  console.error(`\n  ${failures.length} problem(s) found:\n`);
  for (const f of failures) console.error("   ✕ " + f);
  console.error("");
  process.exit(1);
}
console.log(`\n  ✓ ${pages.length} page(s) checked, no problems found.` +
            (warnings.length ? ` ${warnings.length} warning(s) above.` : "") + "\n");
