/* ============================================================
   Nerve feedback form — progressive enhancement.

   The form works without this file: it is a plain POST to
   /api/feedback, and the endpoint returns a readable HTML page.
   With JS we add inline validation, conditional bug fields, and
   an in-page result so the user never loses what they typed.
   ============================================================ */
(function () {
  "use strict";

  var form = document.getElementById("feedback-form");
  // The form is hidden by the build while release.json has feedback.formEnabled=false.
  // Nothing to enhance in that case — the page shows the email route instead.
  if (!form || form.hidden) return;

  var statusBox = document.getElementById("form-status");
  var submitBtn = document.getElementById("submit-btn");
  var bugFields = document.getElementById("bug-fields");
  var followUp = document.getElementById("followUp");
  var email = document.getElementById("email");

  /* Timing check for spam prevention — set on load, checked server-side. */
  var loadedAt = document.getElementById("formLoadedAt");
  if (loadedAt) loadedAt.value = String(Date.now());

  /* ---------- conditional bug fields ---------- */
  function syncBugFields() {
    var picked = form.querySelector('input[name="category"]:checked');
    var isBug = !!picked && picked.value === "bug";
    /* Only hide once JS is running, so no-JS users still see every field. */
    bugFields.hidden = !isBug;
  }
  Array.prototype.forEach.call(
    form.querySelectorAll('input[name="category"]'),
    function (el) { el.addEventListener("change", syncBugFields); }
  );
  syncBugFields();

  /* ---------- validation ---------- */
  function setError(id, show, control) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle("show", show);
    if (control) {
      if (show) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
  }

  function validate() {
    var problems = [];

    var category = form.querySelector('input[name="category"]:checked');
    setError("err-category", !category);
    if (!category) problems.push(form.querySelector('input[name="category"]'));

    var summary = document.getElementById("summary");
    var badSummary = summary.value.trim().length === 0;
    setError("err-summary", badSummary, summary);
    if (badSummary) problems.push(summary);

    var description = document.getElementById("description");
    var badDescription = description.value.trim().length === 0;
    setError("err-description", badDescription, description);
    if (badDescription) problems.push(description);

    var wantsReply = followUp && followUp.checked;
    var v = email.value.trim();
    var badEmail = (wantsReply && v.length === 0) || (v.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
    setError("err-email", badEmail, email);
    if (badEmail) problems.push(email);

    return problems;
  }

  form.addEventListener("input", function (e) {
    /* Clear an error as soon as the user starts fixing it. */
    var t = e.target;
    if (t.id === "summary" && t.value.trim()) setError("err-summary", false, t);
    if (t.id === "description" && t.value.trim()) setError("err-description", false, t);
    if (t.id === "email") setError("err-email", false, t);
  });

  /* ---------- status rendering ---------- */
  function showStatus(kind, heading, bodyHtml) {
    statusBox.className = "form-status show form-status--" + kind;
    statusBox.innerHTML = "<h3>" + heading + "</h3>" + bodyHtml;
    statusBox.focus();
    statusBox.scrollIntoView({ block: "center" });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- submit ---------- */
  form.addEventListener("submit", function (e) {
    var problems = validate();
    if (problems.length) {
      e.preventDefault();
      showStatus(
        "err",
        "Not sent — a few fields need attention",
        "<p>Nothing has been submitted and your text is still here. The fields needing attention are marked below.</p>"
      );
      problems[0].focus();
      return;
    }

    /* fetch is required for the enhanced path; otherwise let the normal POST happen. */
    if (!window.fetch || !window.FormData) return;

    e.preventDefault();

    var payload = {};
    new FormData(form).forEach(function (value, key) { payload[key] = value; });

    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Sending…";
    statusBox.className = "form-status";

    fetch(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.reference) {
          form.hidden = true;
          showStatus(
            "ok",
            "Report received",
            "<p>Thank you — this is stored and we can look it up. Keep the reference number if you " +
            "want to refer to this report later.</p>" +
            '<span class="ref">' + escapeHtml(r.data.reference) + "</span>"
          );
          return;
        }

        var msg = (r.data && r.data.message) ||
          "The report could not be stored. Nothing was lost — your text is still in the form below.";
        showStatus(
          "err",
          r.status === 429 ? "Too many reports, too quickly" : "Not sent",
          "<p>" + escapeHtml(msg) + "</p>" +
          "<p>You can try again, or email the same information to " +
          '<a href="mailto:backchannelstudios1@gmail.com?subject=Nerve%20alpha%20feedback">backchannelstudios1@gmail.com</a>.</p>'
        );
      })
      .catch(function () {
        showStatus(
          "err",
          "Could not reach the server",
          "<p>Your report has not been sent and your text is still in the form below. Check your " +
          "connection and try again, or email the same information to " +
          '<a href="mailto:backchannelstudios1@gmail.com?subject=Nerve%20alpha%20feedback">backchannelstudios1@gmail.com</a>.</p>'
        );
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
