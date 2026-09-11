# Drafts — not published

Files here are **not part of the public site**. `vercel.json` redirects `/drafts/*` away, and
`robots.txt` disallows the path.

- `nerve-terms-draft.html.txt` — the structural draft of the Nerve alpha terms. It lists the
  sections a lawyer needs to fill in: licence grant, ownership, feedback licence, warranty,
  limitation of liability, acceptable use, termination, governing law, and the legal entity
  behind Backchannel Studios.

  To publish it: get the wording approved, drop the approved text into the page, move it back to
  `nerve/terms/index.html`, remove the `noindex` meta tag and the draft banner, restore the
  `Terms` links in the sub-navigation and page footers, add the route back to `sitemap.xml`, and
  remove the `/nerve/terms` redirect and the `robots.txt` disallow.
