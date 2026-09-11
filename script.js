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
});
