/* ============================================================
   POST /api/feedback  —  Nerve alpha feedback intake
   ------------------------------------------------------------
   Design rules this endpoint is built to:

   * Text only. No file uploads, no diagnostic bundles, no archives.
   * Server-side validation. The browser checks are a convenience;
     this is the check that counts.
   * Submitted text is untrusted. It is length-capped, control
     characters are stripped, and it is HTML-escaped before it is
     ever placed in an HTML email body.
   * Never report success unless delivery actually succeeded. If the
     mail provider returns anything other than success, the caller
     gets an error and keeps their text.
   * Accessible spam prevention only: a honeypot field and a
     form-fill timing check, plus rate limiting. No CAPTCHA.
   * No secrets in browser code. Every credential is read from
     Vercel environment variables at request time.

   Required environment variables (Vercel → Project → Settings →
   Environment Variables). Until these are set the endpoint refuses
   every submission with a clear error rather than dropping reports:

     RESEND_API_KEY   API key for the mail provider (resend.com)
     FEEDBACK_TO      Destination inbox for reports
     FEEDBACK_FROM    Verified sender, e.g. "Nerve Feedback
                      <feedback@thebackchannel.studio>"

   Optional:
     FEEDBACK_RATE_MAX      reports per IP per window   (default 5)
     FEEDBACK_RATE_WINDOW   window in seconds           (default 900)
   ============================================================ */

"use strict";

/* ---------- configuration ---------- */

const MAX_BODY_BYTES = 64 * 1024;

const FIELDS = {
  category:        { max: 20,   required: true, oneOf: ["bug", "suggestion", "performance"] },
  summary:         { max: 140,  required: true },
  description:     { max: 6000, required: true },
  nerveVersion:    { max: 60 },
  fgVersion:       { max: 60 },
  ruleset:         { max: 60 },
  provider:        { max: 60 },
  errorCode:       { max: 200 },
  steps:           { max: 4000 },
  expected:        { max: 2000 },
  actual:          { max: 2000 },
  modelTier:       { max: 80 },
  elapsedSeconds:  { max: 10 },
  playMode:        { max: 20, oneOf: ["", "solo", "multiplayer", "unknown"] },
  recordCheck:     { max: 20, oneOf: ["", "yes", "no", "not-checked", "n/a"] },
  otherExtensions: { max: 1500 },
  email:           { max: 254 },
  followUp:        { max: 10 }
};

const LABELS = {
  summary: "Summary",
  description: "Description",
  nerveVersion: "Nerve version",
  fgVersion: "Fantasy Grounds version",
  ruleset: "Ruleset",
  provider: "AI provider",
  errorCode: "Error code",
  steps: "Steps to reproduce",
  expected: "Expected behaviour",
  actual: "Actual behaviour",
  modelTier: "Model / account tier",
  elapsedSeconds: "Response time (seconds)",
  playMode: "Solo or multiplayer",
  recordCheck: "Approved action visible in native record",
  otherExtensions: "Other extensions enabled"
};

const CATEGORY_LABEL = {
  bug: "Bug",
  suggestion: "Suggestion",
  performance: "Performance observation"
};

/* Minimum seconds between page load and submit. A human filling in a
   summary and a description does not get there in under three seconds. */
const MIN_FILL_SECONDS = 3;
const MAX_FILL_HOURS = 24;

/* ---------- rate limiting ----------
   Best effort: serverless instances are ephemeral and there may be
   several of them, so this throttles bursts from one client rather
   than enforcing a hard global quota. */
const hits = new Map();

function rateLimited(ip) {
  const max = Number(process.env.FEEDBACK_RATE_MAX || 5);
  const windowMs = Number(process.env.FEEDBACK_RATE_WINDOW || 900) * 1000;
  const now = Date.now();

  for (const [key, times] of hits) {
    const kept = times.filter((t) => now - t < windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
  }
  if (hits.size > 5000) hits.clear();

  const mine = hits.get(ip) || [];
  if (mine.length >= max) return true;
  mine.push(now);
  hits.set(ip, mine);
  return false;
}

/* ---------- helpers ---------- */

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function clean(value, max) {
  if (value === undefined || value === null) return "";
  let s = String(value);
  /* strip control characters except tab/newline/carriage return */
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\r\n/g, "\n").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function makeReference() {
  const d = new Date();
  const day =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; /* no I, L, O, 0, 1 */
  let tail = "";
  const bytes = require("crypto").randomBytes(6);
  for (let i = 0; i < 6; i++) tail += alphabet[bytes[i] % alphabet.length];
  return `NRV-${day}-${tail}`;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== "string") {
    return { parsed: req.body, raw: null };
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("TOO_LARGE");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] || "");

  if (type.includes("application/json")) {
    try { return { parsed: JSON.parse(raw), raw }; }
    catch { throw new Error("BAD_JSON"); }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return { parsed: out, raw };
  }
  try { return { parsed: JSON.parse(raw), raw }; }
  catch { throw new Error("BAD_CONTENT_TYPE"); }
}

function wantsJson(req) {
  const accept = String(req.headers["accept"] || "");
  const type = String(req.headers["content-type"] || "");
  return accept.includes("application/json") || type.includes("application/json");
}

/* ---------- responses ---------- */

const STUDIO_EMAIL = "backchannelstudios1@gmail.com";

function htmlPage(title, heading, bodyHtml, status) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Nerve</title>
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="stylesheet" href="/style.css" /></head>
<body><main id="main"><div class="doc doc-narrow" style="padding-top:80px">
<h1 style="font-size:clamp(1.8rem,4vw,2.5rem);margin:0 0 20px">${escapeHtml(heading)}</h1>
${bodyHtml}
<p style="margin-top:40px"><a class="btn btn-secondary" href="/nerve/feedback/">← Back to the feedback form</a></p>
</div></main></body></html>`;
}

function respond(req, res, status, payload) {
  if (wantsJson(req)) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(payload));
  }
  const ok = status >= 200 && status < 300;
  const body = ok
    ? `<p>Your report is stored. Keep this reference if you want to refer to it later.</p>
       <p style="font-family:var(--mono);font-size:1.1rem;color:var(--accent)">${escapeHtml(payload.reference)}</p>`
    : `<p>${escapeHtml(payload.message)}</p>
       <p>Use the back button to return to the form — your text should still be there. You can also
       email the same information to <a href="mailto:${STUDIO_EMAIL}">${STUDIO_EMAIL}</a>.</p>`;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(htmlPage(ok ? "Report received" : "Report not sent",
                          ok ? "Report received" : "Report not sent", body, status));
}

/* ---------- mail delivery ---------- */

async function deliver(report) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO;
  const from = process.env.FEEDBACK_FROM;
  if (!key || !to || !from) throw new Error("NOT_CONFIGURED");

  const rows = Object.keys(LABELS)
    .filter((k) => report[k])
    .map(
      (k) =>
        `<tr><th align="left" valign="top" style="padding:6px 14px 6px 0;color:#555;font-weight:600;white-space:nowrap">${escapeHtml(
          LABELS[k]
        )}</th><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(report[k])}</td></tr>`
    )
    .join("");

  const replyTo = report.email && validEmail(report.email) ? report.email : undefined;

  const text = [
    `Nerve alpha feedback — ${CATEGORY_LABEL[report.category]}`,
    `Reference: ${report.reference}`,
    `Received:  ${report.receivedAt}`,
    `Reply requested: ${report.followUp === "yes" ? "yes" : "no"}`,
    `Contact: ${report.email || "(none supplied)"}`,
    "",
    ...Object.keys(LABELS)
      .filter((k) => report[k])
      .map((k) => `${LABELS[k]}:\n${report[k]}\n`)
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      reply_to: replyTo,
      subject: `[Nerve ${CATEGORY_LABEL[report.category]}] ${report.summary} (${report.reference})`,
      text,
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">
        <p style="margin:0 0 4px"><strong>Nerve alpha feedback — ${escapeHtml(CATEGORY_LABEL[report.category])}</strong></p>
        <p style="margin:0 0 18px;color:#666">Reference <code>${escapeHtml(report.reference)}</code> ·
        ${escapeHtml(report.receivedAt)} ·
        reply requested: ${report.followUp === "yes" ? "yes" : "no"} ·
        contact: ${escapeHtml(report.email || "(none supplied)")}</p>
        <table cellpadding="0" cellspacing="0">${rows}</table>
      </div>`
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DELIVERY_FAILED ${res.status} ${detail.slice(0, 300)}`);
  }
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(req, res, 405, {
      ok: false,
      message: "This endpoint only accepts submissions from the feedback form."
    });
  }

  /* --- read and parse --- */
  let parsed;
  try {
    ({ parsed } = await readBody(req));
  } catch (err) {
    const tooLarge = err.message === "TOO_LARGE";
    return respond(req, res, tooLarge ? 413 : 400, {
      ok: false,
      message: tooLarge
        ? "That report is larger than this form accepts. Please trim it — and remember the form is text only, no bundles or archives."
        : "That submission could not be read. Please try again from the form."
    });
  }
  if (!parsed || typeof parsed !== "object") {
    return respond(req, res, 400, { ok: false, message: "That submission could not be read." });
  }

  /* --- spam checks: honeypot, then timing --- */
  if (clean(parsed.website, 200)) {
    /* Silently accept-looking rejection would be dishonest to a real user,
       but a filled honeypot is never a real user. */
    return respond(req, res, 400, {
      ok: false,
      message: "That submission was rejected by the spam filter. If you are a person seeing this, please email us instead."
    });
  }

  const loadedAt = Number(parsed.formLoadedAt);
  if (Number.isFinite(loadedAt) && loadedAt > 0) {
    const elapsed = (Date.now() - loadedAt) / 1000;
    if (elapsed < MIN_FILL_SECONDS || elapsed > MAX_FILL_HOURS * 3600) {
      return respond(req, res, 400, {
        ok: false,
        message: "That submission was rejected by the spam filter. Please reload the form and try again."
      });
    }
  }

  /* --- rate limit --- */
  if (rateLimited(clientIp(req))) {
    res.setHeader("Retry-After", String(process.env.FEEDBACK_RATE_WINDOW || 900));
    return respond(req, res, 429, {
      ok: false,
      message: "Several reports have already come from this connection recently. Please wait a few minutes and try again — nothing you typed has been lost."
    });
  }

  /* --- validate --- */
  const report = {};
  const errors = [];

  for (const [name, rule] of Object.entries(FIELDS)) {
    const value = clean(parsed[name], rule.max);
    if (rule.oneOf && value && !rule.oneOf.includes(value)) {
      errors.push(`${name} is not a recognised value`);
      continue;
    }
    if (rule.required && !value) errors.push(`${LABELS[name] || name} is required`);
    report[name] = value;
  }
  if (!report.category) errors.push("A category is required");

  const wantsReply = report.followUp === "yes";
  if (report.email && !validEmail(report.email)) {
    errors.push("The email address is not valid");
  }
  if (wantsReply && !report.email) {
    errors.push("An email address is needed to receive a reply");
  }

  if (errors.length) {
    return respond(req, res, 422, {
      ok: false,
      message: "That report is missing something: " + errors.join("; ") + ".",
      errors
    });
  }

  report.reference = makeReference();
  report.receivedAt = new Date().toISOString();

  /* --- deliver; only then report success --- */
  try {
    await deliver(report);
  } catch (err) {
    const notConfigured = err.message === "NOT_CONFIGURED";
    console.error("[feedback] delivery failed", report.reference, err.message);
    return respond(req, res, notConfigured ? 503 : 502, {
      ok: false,
      message: notConfigured
        ? `The feedback form is not connected to a destination yet, so this report was not stored. Please email the same information to ${STUDIO_EMAIL} — sorry for the detour.`
        : `The report could not be stored, so we are not going to tell you it arrived. Nothing you typed has been lost. Please try again, or email the same information to ${STUDIO_EMAIL}.`
    });
  }

  return respond(req, res, 200, { ok: true, reference: report.reference });
};
