#!/usr/bin/env node
/* ============================================================
   test-feedback.mjs — smoke tests for POST /api/feedback.

   Run with `npm run test:feedback`. Mounts the real handler on a
   local server and exercises validation, the spam traps, rate
   limiting, and the rule that matters most: the endpoint never
   reports success unless delivery actually succeeded.

   No network calls leave the machine — the mail provider is
   stubbed. Exits non-zero on any failure.
   ============================================================ */

import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
/* fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/Users/..."
   with a leading slash, which require() cannot resolve. */
const handler = require(fileURLToPath(new URL("../api/feedback.js", import.meta.url)));

const server = http.createServer((req,res)=>handler(req,res));
await new Promise(r=>server.listen(4199,r));
const BASE="http://127.0.0.1:4199";
process.env.FEEDBACK_RATE_MAX="999";

let pass=0, fail=0;
const check=(name,cond,extra="")=>{ if(cond){pass++;console.log("  ✓",name);} else {fail++;console.log("  ✕",name,extra);} };

async function post(body, headers={}, raw=false){
  const res = await fetch(BASE, {method:"POST",
    headers:{ "Content-Type": raw?"application/x-www-form-urlencoded":"application/json",
              "Accept": raw?"text/html":"application/json", ...headers},
    body: raw ? new URLSearchParams(body).toString() : JSON.stringify(body)});
  const text = await res.text();
  let json=null; try{json=JSON.parse(text);}catch{}
  return {status:res.status, json, text};
}

const valid = ()=>({category:"bug", summary:"Call Nerve times out", description:"Waited four minutes.",
  formLoadedAt: String(Date.now()-20000)});

console.log("\n-- method guard --");
const g = await fetch(BASE,{headers:{Accept:"application/json"}});
check("GET is rejected with 405", g.status===405);

console.log("\n-- validation --");
let r = await post({category:"bug", formLoadedAt:String(Date.now()-20000)});
check("missing summary+description -> 422", r.status===422, r.status);
check("error names the missing fields", /Summary/.test(r.json?.message||"") && /Description/.test(r.json?.message||""), r.json?.message);

r = await post({...valid(), category:"nonsense"});
check("unknown category -> 422", r.status===422, r.status);

r = await post({...valid(), followUp:"yes"});
check("reply requested with no email -> 422", r.status===422, r.status);

r = await post({...valid(), email:"not-an-email"});
check("malformed email -> 422", r.status===422, r.status);

console.log("\n-- spam traps --");
r = await post({...valid(), website:"http://spam"});
check("honeypot filled -> rejected", r.status===400, r.status);

r = await post({...valid(), formLoadedAt:String(Date.now()-100)});
check("submitted too fast -> rejected", r.status===400, r.status);

console.log("\n-- no destination configured --");
delete process.env.RESEND_API_KEY;
r = await post(valid());
check("unconfigured -> 503, NOT success", r.status===503 && r.json?.ok!==true, r.status);
check("503 message points at the studio email", /backchannelstudios1@gmail\.com/.test(r.json?.message||""));
check("no reference number is handed out", !r.json?.reference);

console.log("\n-- delivery failure is not success --");
process.env.RESEND_API_KEY="test"; process.env.FEEDBACK_TO="x@y.z"; process.env.FEEDBACK_FROM="a@b.c";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) return new Response("upstream boom", {status:500});
  return realFetch(url, init);
};
r = await post(valid());
check("mail provider 500 -> 502, NOT success", r.status===502 && r.json?.ok!==true, r.status);
check("no reference on failed delivery", !r.json?.reference);

console.log("\n-- successful delivery --");
let captured=null;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) { captured=JSON.parse(init.body); return new Response('{"id":"1"}',{status:200}); }
  return realFetch(url, init);
};
r = await post({...valid(), summary:'XSS <script>alert(1)</script> attempt', email:"tester@example.org", followUp:"yes"});
check("valid report -> 200", r.status===200, r.status);
check("reference number returned", /^NRV-\d{8}-[A-Z2-9]{6}$/.test(r.json?.reference||""), r.json?.reference);
check("submitted text is HTML-escaped in the email body", captured && !/<script>/.test(captured.html) && /&lt;script&gt;/.test(captured.html));
check("plain-text alternative is sent too", !!captured?.text);
check("reply-to set from the supplied address", captured?.reply_to==="tester@example.org");

console.log("\n-- rate limiting --");
process.env.FEEDBACK_RATE_MAX="3";
let limited=false;
for (let i=0;i<8;i++){ const x=await post(valid()); if(x.status===429){limited=true;break;} }
check("burst is rate limited with 429", limited);

console.log("\n-- no-JS form post returns HTML --");
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) return new Response('{"id":"1"}',{status:200});
  return realFetch(url, init);
};
process.env.FEEDBACK_RATE_MAX="999";
r = await post(valid(), {}, true);
check("urlencoded POST returns an HTML page", r.status===200 && /<!doctype html>/i.test(r.text), r.status);
check("HTML page shows the reference", /NRV-\d{8}-/.test(r.text));

server.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
