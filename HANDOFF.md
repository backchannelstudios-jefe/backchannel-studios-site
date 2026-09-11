# Nerve site — implementation handoff

Built against **Nerve Alpha Website — Development Requirements** (10 September 2026) and the
**Nerve website review** (11 September 2026). Current release: **0.67.1 (alpha)**.

**Both halves are published.** The Forge listing is public
([item 3596](https://forge.fantasygrounds.com/shop/items/3596/view)) and the Windows companion
downloads from this site. Nerve needs both, so neither control replaces the other.

**What being listed does not mean.** A signed-in acquisition plus an install through the Fantasy
Grounds updater has not been run end to end. `forge.installVerified` in `nerve/release.json` is
`false`, and while it is false the downloads and setup pages say plainly that the path is not
proven. Set it to `true` only once that test has actually passed — nothing else on the site
claims it has. Being listed on the Forge is a moderation outcome, not endorsement, certification
or permission from SmiteWorks, and `npm run check` fails the build if any page says otherwise.

---

## 1. What was added

| Path | What it is |
| --- | --- |
| `/nerve` | Product overview — alpha label, value statement, requirements, how the three pieces fit together, what testers can explore, known limitations, privacy summary |
| `/nerve/setup` | Ten-step ordered install, update paths, developer-preview migration, troubleshooting table |
| `/nerve/downloads` | Prerequisites, current release metadata, companion + checksum + Forge controls, the forum route, previous releases |
| `/nerve/releases` | Version pairing table, per-release known issues, update instructions |
| `/nerve/privacy` | Product data flow and website data collection, kept strictly apart |
| `/nerve/feedback` | Two report routes — the public forum thread and private email — with a shared what-to-include checklist and a redaction warning on the public one. The in-page form is built but hidden until it has a destination |
| `downloads/nerve/<ver>/` | The published companion ZIP and its generated `.sha256` sidecar |
| `drafts/` | Unpublished work — currently the Terms draft. Redirected away, robots-disallowed |
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

## 3. Publishing a new companion build — three steps

Never type a version number, a file size or a checksum into an HTML file. Everything comes from
**`nerve/release.json`**.

1. **Upload the ZIP** to `downloads/nerve/<version>-<channel>/` on GitHub.
   Always a new folder. Never replace a file at a path that has already been published — people
   may have linked to it, and a changed file under an old URL breaks checksum verification.
2. **Edit four fields** in `nerve/release.json`: `version`, `channel`, `releaseDate`, and
   `companion.path` (pointing at the file you just uploaded).
3. **Commit.** Done.

On deploy, `npm run build` opens the ZIP and works out the rest itself:

| Derived automatically | From |
| --- | --- |
| SHA-256 digest | hashing the actual ZIP in the repo |
| File size, and its label (`1.19 MB`) | the real byte length |
| Download URL and filename | `companion.path` |
| The `.sha256` sidecar file | written next to the ZIP |
| `0.67.1 (alpha)` version label | `version` + `channel` |
| `Nerve Adapter v0.67.1 loaded.` | `extensionVersion` |
| `11 September 2026` date | `releaseDate` |

Because the digest is taken from the same bytes Vercel serves, **the published checksum cannot
drift from the published file.** `npm run check` re-verifies this independently and fails if the
number on the page, the sidecar and the file ever disagree — I tested that guard by deliberately
corrupting each one.

The build refuses to publish, and fails the deploy, if the ZIP is missing, if the version string
does not appear in the filename (the classic "new build, forgot the version bump"), or if a
status is `available` without what that status requires. A failed build leaves the previous
deployment serving, so a mistake here cannot take the site down.

**To unpublish**, set `companion.status` back to `"pending"`. The download reverts to a
non-clickable disabled control and the pages round-trip byte-for-byte.

**The Forge item is live** — `forge.status` is `"available"` and `forge.url` holds the published
item. Setting it back to `"pending"` restores the release-preview copy byte-for-byte; the pending
text is kept in the pages, hidden, precisely so that round trip stays lossless.

**The one flag left to flip** is `forge.installVerified`. Set it to `true` after acquiring the
listing while signed in and installing through the Fantasy Grounds updater on a clean profile.
That removes the caveat from the downloads and setup pages and nothing else.

## 3b. The external destinations

| Field in `release.json` | Where it points | Rendered as |
| --- | --- | --- |
| `forge.url` | the published Forge item | "Get Nerve on Forge" — primary call to action |
| `community.forumUrl` | the public Fantasy Grounds thread | "Discussion and bug reports" |
| `support.url` | the same Forge item | "Support Nerve on Forge" |

`npm run check` asserts each control resolves to exactly the published item or thread — a typo
here is a link into someone else's product, so it fails the check rather than warning. It also
fails if a Nerve page links to Buy Me a Coffee: that endpoint was removed from the Forge listing
by the owner, so Nerve support goes through the listing's own options instead. **Do not add a
direct donation endpoint, and do not let any copy imply donating is required or unlocks
anything.** A studio-wide support page is a separate matter and is untouched by this.

Feedback has two routes. The forum thread is public and hosted by SmiteWorks — not ours to take
down — so `/nerve/feedback` tells reporters to redact personal information, credentials and
private campaign material before posting, and to keep support bundles out of public posts. Email
stays for anything private. `/nerve/privacy` draws the same distinction.

## 4. Turning the feedback form on

The form and its endpoint are built, tested and sitting in the repo, but **the page currently
shows an email route instead** — a tester is not asked to fill in twenty fields only to be told
the endpoint is off. To switch over:

1. Set these in Vercel → Project → Settings → Environment Variables:
   - `RESEND_API_KEY` — an API key from resend.com (or swap the ~25-line `deliver()` function in
     `api/feedback.js` for another provider)
   - `FEEDBACK_TO` — the inbox reports land in
   - `FEEDBACK_FROM` — a verified sender, e.g. `Nerve Feedback <feedback@thebackchannel.studio>`
2. Set `feedback.formEnabled` to `true` in `nerve/release.json`.
3. Update the "What happens to a feedback report" section of `/nerve/privacy` to say where
   reports are stored and how long they are kept. Do this **before** step 2, not after.

Send one real report and confirm it arrives before telling testers the form works.

## 4b. The Terms page

`/nerve/terms` is no longer published. The review was right that a public page saying it should
not be public is worse than no page. The draft now lives at
`drafts/nerve-terms-draft.html.txt` — redirected away and disallowed in `robots.txt` — and
`drafts/README.md` lists exactly what a lawyer needs to supply and the steps to publish it.
`/nerve/terms` redirects to `/nerve/privacy` so any existing link still lands somewhere useful.

## 5. Test report

`npm run verify` runs all three suites. Latest run, all green:

**Release stamping** — 9 pages scanned. Round-trip tested pending → available → pending;
output is byte-identical, so nothing is lost by flipping status either way.

**Pre-publication checks (`npm run check`)** — 8 pages, no problems:
- every internal link and asset reference resolves; every `#anchor` has a matching `id`
- no placeholder link is clickable anywhere
- no prohibited claim wording (guaranteed response times, universal provider compatibility,
  complete rules automation, SmiteWorks endorsement, **Forge listing described as SmiteWorks
  approval, certification or permission**, **donating implied to be required**, lifetime access,
  tax deductibility, premium support, "data never leaves your computer", DM replacement,
  donation dashboard URL)
- **the Forge, forum and support controls resolve to exactly the published item and thread**
- **no Nerve page links to Buy Me a Coffee**
- **no visible copy still calls the Forge listing pending** while `forge.status` is `available`
  (hidden pending blocks are skipped, so the pending → available round trip stays lossless)
- every page has a title, description, canonical, favicon, skip link, `lang`, one `<h1>`, and
  `alt` on every image

Each of the four new guards was proven by deliberately breaking it — wrong item number, wrong
thread id, a stale donation link, and "Approved by SmiteWorks" — and confirming the check failed.

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
| 4 | Support link correct, no dashboard URL, no invented donation endpoint | ✅ Nerve support goes to the Forge listing; `npm run check` fails on a Buy Me a Coffee link on any Nerve page |
| 5 | Hosted download succeeds and SHA-256 matches | ✅ served ZIP, sidecar and page value all hash to `23de585d…`, verified against the live site |
| 6 | Every displayed version matches the approved release | ✅ all generated from `release.json` |
| 7 | Forge status truthful, no clickable placeholder | ✅ listing is live and linked; the untested-install caveat is stated, not glossed |
| 8 | No submission bundle, internal notes, campaign data or credentials public | ✅ none present; downloads page says so |
| 9 | Setup explains extension/runtime ownership and migration | ✅ |
| 10 | Known limitations include quest visibility, bookkeeping, latency, AI errors | ✅ overview and release notes |
| 11 | Feedback success/failure, validation and spam protection tested | ✅ 21 assertions |
| 12 | Privacy and terms reflect approved wording | ⏳ **awaiting owner wording** |
| 13 | Desktop/mobile and keyboard checks pass | ✅ |
| 14 | Product owner approves staging before production | ✅ Neal approved; live as of 11 September 2026 |

---

## 7. Commands

```
npm run build          # stamp release.json into the pages (Vercel runs this)
npm run check          # link, claim and accessibility-structure checks
npm run test:feedback  # 21 endpoint assertions, no network calls
npm run verify         # all three
npm run dev            # serve locally
```
