# Nerve site — implementation handoff

Built against **Nerve Alpha Website — Development Requirements** (10 September 2026),
release candidate 0.67.1-alpha.

**Nothing on these pages claims the release is published.** Every download control renders as a
non-clickable, disabled element until you approve the artifacts. That is deliberate and enforced
by a build-time check.

---

## 1. What was added

| Path | What it is |
| --- | --- |
| `/nerve` | Product overview — alpha label, value statement, requirements, how the three pieces fit together, what testers can explore, known limitations, privacy summary |
| `/nerve/setup` | Ten-step ordered install, update paths, developer-preview migration, troubleshooting table |
| `/nerve/downloads` | Prerequisites, current release metadata, companion + checksum + Forge controls, previous releases |
| `/nerve/releases` | Version pairing table, per-release known issues, update instructions |
| `/nerve/feedback` | Bug / Suggestion / Performance form with server-side validation |
| `/nerve/privacy` | Product data flow and website data collection, kept strictly apart |
| `/nerve/terms` | Structural draft — **`noindex`, not for publication** until you supply wording |
| `/api/feedback` | Vercel serverless intake for the form |
| `nerve/release.json` | Single source of truth for every version, filename, checksum and link |
| `tools/*.mjs` | Release stamper, pre-publication checker, endpoint test suite |
| `assets/*`, `favicon.ico` | Logo derivatives, Nerve artwork, social previews |

Existing pages changed: `index.html` (logo, favicon, social preview, **Nerve "Learn more" now
points at `/nerve`**, Free Alpha badge, Nerve added to the main nav, footer nav),
`projects.html` (same, plus the real Nerve emblem replaces the placeholder asset plates),
`style.css`, `vercel.json`, `package.json`.

---

## 2. Deployment

Push to `main` on `backchannelstudios-jefe/backchannel-studios-site`. Vercel auto-deploys and now
runs `npm run build` first, which stamps `nerve/release.json` into the pages. Opening a pull
request instead gives you a **Vercel preview URL** — that is your staging environment for owner
review before anything reaches production.

`vercel.json` keeps `outputDirectory: "."` (still required, unchanged) and adds security headers,
long-cache headers for `/assets/*`, and a few convenience redirects (`/nerve/download` →
`/nerve/downloads`, and similar).

**Rollback:** revert the commit and push, or promote the previous deployment in the Vercel
dashboard. Nothing about this change makes rollback harder.

---

## 3. Editing release data — the one file that matters

Never type a version number into an HTML file. Edit **`nerve/release.json`** and push; the build
rewrites every page. When you are ready to publish the companion:

```jsonc
"releaseDate": "2026-09-25",
"releaseDateLabel": "25 September 2026",
"companion": {
  "status": "available",                              // was "pending"
  "filename": "Nerve-Windows-Companion-0.67.1-alpha.zip",
  "url": "https://<your-storage>/nerve/0.67.1-alpha/Nerve-Windows-Companion-0.67.1-alpha.zip",
  "sizeLabel": "1.1 MB",
  "sha256": "<64 hex chars, calculated from the file you actually hosted>",
  "checksumUrl": "https://<your-storage>/nerve/0.67.1-alpha/…zip.sha256"
},
"forge": { "status": "available", "url": "https://forge.fantasygrounds.com/shop/items/…" }
```

The build **fails loudly** rather than publishing something misleading if you mark an artifact
`available` without an `https://` URL, a valid 64-character SHA-256, a checksum URL, a file size,
or a release date. A link is only ever rendered as clickable when its status is `available` *and*
its URL is https. Flipping back to `pending` restores the disabled controls exactly — it round-trips
byte-for-byte, so a premature publish is a one-line revert.

Use immutable versioned paths. Do not replace bytes at a URL you have already published.

---

## 4. Before the feedback form can go live — owner input required

The form is built and tested, but **not connected**, and the pages say so plainly. Three things
are needed:

1. **A destination.** Set these in Vercel → Project → Settings → Environment Variables:
   - `RESEND_API_KEY` — an API key from resend.com (or swap `deliver()` in `api/feedback.js` for
     another provider; it is about 25 lines)
   - `FEEDBACK_TO` — the inbox reports land in
   - `FEEDBACK_FROM` — a verified sender, e.g. `Nerve Feedback <feedback@thebackchannel.studio>`

   Until these exist the endpoint returns a clear 503 and points testers at the studio email. It
   does **not** silently accept and drop reports.

2. **Approved privacy wording** for where reports are stored, who can read them, how long they are
   kept, and how someone asks for deletion. The placeholders on `/nerve/privacy` are marked with a
   dashed amber box. No retention period or response-time promise was invented.

3. **Approved terms wording.** `/nerve/terms` lists the sections a lawyer needs to fill
   (licence grant, ownership, feedback licence, warranty, liability, acceptable use, governing law,
   the legal entity). The page is `noindex` and disallowed in `robots.txt` until then.

Search the repo for `owner-input` to find every block that needs your sign-off.

---

## 5. Test report

`npm run verify` runs all three suites. Latest run, all green:

**Release stamping** — 9 pages scanned. Round-trip tested pending → available → pending;
output is byte-identical, so nothing is lost by flipping status either way.

**Pre-publication checks (`npm run check`)** — 9 pages, no problems:
- every internal link and asset reference resolves; every `#anchor` has a matching `id`
- no placeholder link is clickable anywhere
- no prohibited claim wording (guaranteed response times, universal provider compatibility,
  complete rules automation, SmiteWorks endorsement, lifetime access, tax deductibility, premium
  support, "data never leaves your computer", DM replacement, donation dashboard URL)
- every page has a title, description, canonical, favicon, skip link, `lang`, one `<h1>`, and
  `alt` on every image

**Endpoint tests (`npm run test:feedback`)** — 21 assertions, all passing:
- GET rejected; missing/invalid fields rejected with a message naming them
- honeypot and too-fast submission rejected; burst traffic rate limited with 429
- **unconfigured destination → 503, no reference number, no false success**
- **mail provider failure → 502, no reference number, no false success**
- successful delivery → 200 with a `NRV-YYYYMMDD-XXXXXX` reference
- submitted text is HTML-escaped in the email body (XSS payload verified inert)
- a no-JavaScript form post returns a readable HTML page carrying the reference

**Browser tests** — 20 assertions on the live form: bug fields appear only for bug reports;
empty submit shows inline errors and sends nothing; errors clear as you type; a server error keeps
every character the user typed; success shows the reference and hides the form; the skip link is
the first tab stop and becomes visible on focus.

**Accessibility** — checked in Chromium across all 9 pages at 1280px and 390px:
- contrast meets WCAG 2.2 AA everywhere (translucent backgrounds composited properly).
  `--text-faint` was raised from `#63666d` to `#8a8e96`, which the old pages needed too.
- every interactive target meets the 24×24 minimum (SC 2.5.8); nav and footer links were adjusted
- every form control has a programmatic label; heading order never skips a level
- no horizontal overflow at 390px; wide tables scroll inside their own container
- `prefers-reduced-motion` honoured

**Not tested, and not claimed anywhere on the site:** Forge moderation, real download and update
delivery, and clean-profile public installation. The pages state these are still to be validated.

---

## 6. Acceptance checklist (requirements §12)

| # | Item | State |
| --- | --- | --- |
| 1 | Homepage Nerve link reaches the dedicated page | ✅ `/nerve` |
| 2 | Alpha status and all prerequisites visible before download | ✅ overview, downloads and setup all list all six |
| 3 | Free access independent of donations or registration | ✅ stated on overview and terms |
| 4 | Public donation link correct, no dashboard URL | ✅ checked by `npm run check` |
| 5 | Hosted download succeeds and SHA-256 matches | ⏳ no artifact published yet |
| 6 | Every displayed version matches the approved release | ✅ all generated from `release.json` |
| 7 | Forge status truthful, no clickable placeholder | ✅ enforced at build time |
| 8 | No submission bundle, internal notes, campaign data or credentials public | ✅ none present; downloads page says so |
| 9 | Setup explains extension/runtime ownership and migration | ✅ |
| 10 | Known limitations include quest visibility, bookkeeping, latency, AI errors | ✅ overview and release notes |
| 11 | Feedback success/failure, validation and spam protection tested | ✅ 21 assertions |
| 12 | Privacy and terms reflect approved wording | ⏳ **awaiting owner wording** |
| 13 | Desktop/mobile and keyboard checks pass | ✅ |
| 14 | Product owner approves staging before production | ⏳ **yours to do** — open a PR for a preview URL |

---

## 7. Commands

```
npm run build          # stamp release.json into the pages (Vercel runs this)
npm run check          # link, claim and accessibility-structure checks
npm run test:feedback  # 21 endpoint assertions, no network calls
npm run verify         # all three
npm run dev            # serve locally
```
