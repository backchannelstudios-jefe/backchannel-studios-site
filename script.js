// Backchannel Studios — small site behaviors (no framework needed)
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");

  if (toggle && nav) {
    // One place that sets both the class and the ARIA state, so they can never
    // drift apart — closing via a link or Escape used to leave aria-expanded="true".
    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };

    setOpen(false);

    toggle.addEventListener("click", () => {
      setOpen(!nav.classList.contains("open"));
    });

    nav.querySelectorAll(".nav-links a, .nav-cta").forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });

    // Escape closes the menu and returns focus to the control that opened it.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Clicking outside the open menu closes it.
    document.addEventListener("click", (e) => {
      if (nav.classList.contains("open") && !nav.contains(e.target)) setOpen(false);
    });

    // If the viewport grows past the mobile breakpoint the menu is shown by CSS
    // anyway, so drop the open state rather than leaving a stale ARIA value.
    const wide = window.matchMedia("(min-width: 721px)");
    const onWide = (e) => { if (e.matches) setOpen(false); };
    wide.addEventListener ? wide.addEventListener("change", onWide) : wide.addListener(onWide);
  }

  // set current year in footer
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Shall we play a game? Typing a certain name (or the Konami code) anywhere on the
  // site opens a terminal. Tapping the footer line three times does the same on a phone.
  const door = () => {
    document.body.style.transition = "opacity .35s";
    document.body.style.opacity = "0";
    setTimeout(() => { window.location.href = "/wopr#joshua"; }, 380);
  };
  const secrets = ["joshua", "ArrowUpArrowUpArrowDownArrowDownArrowLeftArrowRightArrowLeftArrowRightba"];
  let typed = "";
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    typed = (typed + (e.key.length === 1 ? e.key.toLowerCase() : e.key)).slice(-80);
    if (secrets.some((s) => typed.endsWith(s))) { typed = ""; door(); }
  });
  const hint = document.querySelector("[data-wopr-hint]");
  if (hint) {
    let taps = 0, timer = null;
    hint.addEventListener("click", () => {
      taps++; clearTimeout(timer); timer = setTimeout(() => (taps = 0), 900);
      if (taps >= 3) door();
    });
  }
  if (window.console && console.log) console.log("%cLOGON: _", "font-family:monospace;color:#a8ecff;background:#02070a;padding:4px 8px");
});
