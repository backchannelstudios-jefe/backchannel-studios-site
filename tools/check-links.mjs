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
  [/buymeacoffee\.com\/(dashboard|home)/i, "uses the donation dashboard URL instead of the public link"],
  /* Being listed on the Forge is a moderation outcome, not an endorsement. */
  [/(approved|certified|vetted|endorsed|permitted|authoris?zed)\s+by\s+smiteworks/i,
   "describes Forge publication as SmiteWorks endorsement or permission"],
  [/smiteworks\s+(has\s+)?(approved|endorsed|certified|authoris?zed|permitted)/i,
   "describes Forge publication as SmiteWorks endorsement or permission"],
  [/(explicit|express|written)\s+permission\s+(from|of)\s+smiteworks/i,
   "claims explicit permission from SmiteWorks"],
  [/donation\s+is\s+required|must\s+donate|required\s+to\s+donate/i,
   "implies donating is required"]
];

/* Exact external destinations. A typo here is a link into someone else's product. */
const FORGE_URL = "https://forge.fantasygrounds.com/shop/items/3596/view";
const FORUM_URL = "https://www.fantasygrounds.com/forums/showthread.php?88108";

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

  /* Nerve-specific support now goes through the Forge listing. Buy Me a Coffee was
     removed from the Forge item by the owner, so a stale link on a Nerve page would
     send supporters somewhere the product no longer points. Studio-wide pages are
     deliberately out of scope. */
  if (page === "nerve/index.html" || page.startsWith("nerve/")) {
    for (const ref of refs) {
      if (/buymeacoffee\.com/i.test(ref)) {
        fail(page, `Nerve pages must not link to Buy Me a Coffee — support goes to the Forge listing (found "${ref}")`);
      }
    }
  }

  /* Every generated external control must land on exactly the right item/thread,
     whether the build replaced the whole element (data-rel-link) or only its href
     (data-rel-href). A control still rendered as a disabled <span> is not checked
     here — it carries no destination to get wrong. */
  for (const [, tag] of html.matchAll(/<a\s([^>]*\sdata-rel-(?:link|href)="(?:forge|forum|support)"[^>]*)>/g)) {
    const kind = /\sdata-rel-(?:link|href)="([^"]*)"/.exec(tag)?.[1];
    const href = /(?:^|\s)href="([^"]*)"/.exec(tag)?.[1] ?? "";
    const want = kind === "forum" ? FORUM_URL : FORGE_URL;
    if (href !== want) {
      fail(page, `the ${kind} control points at "${href}", expected exactly "${want}"`);
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

if (rel.forge?.status === "available" && rel.forge?.url !== FORGE_URL) {
  fail("nerve/release.json", `forge.url should be "${FORGE_URL}", got "${rel.forge?.url}"`);
}
if (rel.community?.forumUrl !== FORUM_URL) {
  fail("nerve/release.json", `community.forumUrl should be "${FORUM_URL}", got "${rel.community?.forumUrl}"`);
}
if (rel.support?.url !== FORGE_URL) {
  fail("nerve/release.json", `Nerve support should point at the Forge listing, got "${rel.support?.url}"`);
}
if (/buymeacoffee/i.test(JSON.stringify(rel.support || {}).replace(/"_[^"]*":\s*(\[[^\]]*\]|"[^"]*")/g, ""))) {
  fail("nerve/release.json", "support still carries a Buy Me a Coffee endpoint for Nerve");
}

/* ---------- nothing visible may still call the Forge listing pending ----------
   The pending copy is kept in the pages (hidden) so that flipping the status back
   round-trips byte-for-byte. This check reads only what a visitor would see. */
if (rel.forge?.status === "available") {
  /* Remove any element the build hid, including everything nested inside it. */
  function stripHiddenBlocks(html) {
    const open = /<([a-z]+)([^>]*\s(?:data-rel-when|data-rel-note)="[^"]*"[^>]*\shidden(?=[\s>])[^>]*)>/i;
    let out = html, guard = 0;
    for (;;) {
      const m = open.exec(out);
      if (!m || ++guard > 500) break;
      const tag = m[1];
      const re = new RegExp(`</?${tag}\\b`, "gi");
      re.lastIndex = m.index + m[0].length;
      let depth = 1, end = out.length, hit;
      while ((hit = re.exec(out))) {
        depth += hit[0][1] === "/" ? -1 : 1;
        if (depth === 0) { end = hit.index + tag.length + 3; break; }
      }
      out = out.slice(0, m.index) + " " + out.slice(end);
    }
    return out;
  }

  const PENDING = [
    /forge\s+(release|listing|item|submission)\s+(is\s+)?pending/i,
    /pending\s+(forge\s+)?(approval|moderation|review)/i,
    /(not|isn't|is not)\s+(yet\s+)?(available|published|live)\s+on\s+the\s+forge/i,
    /awaiting\s+(forge|smiteworks)/i,
    /release\s+preview/i
  ];
  for (const page of pages.filter((p) => p.startsWith("nerve/"))) {
    const visible = stripHiddenBlocks(await readFile(join(ROOT, page), "utf8"))
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    for (const re of PENDING) {
      const hit = re.exec(visible);
      if (hit) fail(page, `visible text still says the Forge listing is pending: "${hit[0].trim()}"`);
    }
  }
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
