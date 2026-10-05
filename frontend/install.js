/* Lune — install.
 *
 * Registers the service worker (sw.js beside index.html) and wires every
 * "Install Lune" button (any element with data-install: the landing page,
 * the signed-in home, Settings and the More menu).
 *
 * Where the browser can install the site itself (Chrome, Edge, Samsung
 * Internet, and others that fire beforeinstallprompt) the button opens the
 * browser's own install prompt. Everywhere else (Safari on iPhone, iPad and
 * Mac, Firefox) it opens short instructions for that browser, with the other
 * platforms listed below. Once Lune runs as an installed app the buttons hide.
 */
(function () {
  const installed = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  let offer = null;

  /** Which instructions to show first. */
  function platform() {
    const ua = navigator.userAgent || "";
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPod/.test(ua)) return "iphone";
    if (/iPad/.test(ua) || touchMac) return "ipad";
    if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? "samsung" : /Firefox/.test(ua) ? "android-firefox" : "android";
    if (/Edg\//.test(ua)) return "edge";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return "chrome";
    if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "mac-safari";
    return "other";
  }

  const STEPS = {
    iphone: {
      title: "iPhone",
      steps: [
        "Open lune.page in Safari (Chrome and Edge on iPhone work too, from their Share button).",
        "Tap the Share button: the square with an arrow pointing up. In newer Safari it is in the ⋯ menu beside the address.",
        "Scroll down and tap Add to Home Screen, then Add.",
      ],
    },
    ipad: {
      title: "iPad",
      steps: [
        "Open lune.page in Safari.",
        "Tap the Share button (the square with an arrow pointing up) at the top of the screen.",
        "Tap Add to Home Screen, then Add.",
      ],
    },
    android: {
      title: "Android (Chrome)",
      steps: ["Tap the ⋮ menu at the top right.", "Tap Add to Home screen, then Install (some versions say Install app)."],
    },
    samsung: {
      title: "Android (Samsung Internet)",
      steps: ["Tap the menu (three lines) at the bottom.", "Tap Add page to, then Home screen."],
    },
    "android-firefox": {
      title: "Android (Firefox)",
      steps: ["Tap the ⋮ menu.", "Tap Add to Home screen (some versions say Install), then Add."],
    },
    "mac-safari": {
      title: "Mac (Safari 17 or later)",
      steps: ["With Lune open, choose File, then Add to Dock (or press Share in the toolbar, then Add to Dock).", "Press Add. Lune opens from the Dock in its own window."],
    },
    chrome: {
      title: "Chrome on a computer",
      steps: [
        "Click the install icon at the right end of the address bar (a screen with a down arrow).",
        "Or open the ⋮ menu, then Cast, save and share, then Install page as app. Click Install.",
      ],
    },
    edge: {
      title: "Microsoft Edge",
      steps: ["Click the App available icon in the address bar.", "Or open the ⋯ menu, then Apps, then Install this site as an app. Click Install."],
    },
    firefox: {
      title: "Firefox on a computer",
      steps: ["Firefox on Windows, Mac and Linux does not install websites as apps. Open lune.page in Chrome, Edge or Safari to install it, or keep using it here in a tab."],
    },
    other: {
      title: "Other browsers",
      steps: ["Look in the browser’s menu for Install, Add to Home Screen or Add to Dock. If there is none, Lune works the same in a browser tab."],
    },
  };
  const ORDER = ["iphone", "ipad", "android", "samsung", "android-firefox", "mac-safari", "chrome", "edge", "firefox"];

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const block = (k, open) =>
    `<details class="install-platform"${open ? " open" : ""}><summary>${esc(STEPS[k].title)}</summary><ol>${STEPS[k].steps
      .map((s) => `<li>${esc(s)}</li>`)
      .join("")}</ol></details>`;

  function openInstructions() {
    let d = document.getElementById("install-dialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "install-dialog";
      d.className = "credits-dialog lp-dialog install-dialog";
      d.setAttribute("aria-labelledby", "install-h");
      document.body.appendChild(d);
    }
    const here = platform();
    d.innerHTML = `<form method="dialog" class="credits-close-row"><button type="submit" class="icon-btn" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></form>
      <h2 id="install-h">Install Lune</h2>
      <p class="settings-note">Lune installs from the browser. It is not an App Store or Play Store app, it is free, and it needs no account. Installed, it opens in its own window, and pieces you have opened work without a connection.</p>
      <h3>On this device</h3>
      ${block(here, true)}
      <h3>Other devices</h3>
      ${ORDER.filter((k) => k !== here).map((k) => block(k, false)).join("")}`;
    if (!d.open) d.showModal();
  }

  /** Show or hide every install button. */
  function paint() {
    const on = !installed();
    document.querySelectorAll("[data-install]").forEach((b) => {
      b.hidden = !on;
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no browser mini-banner; the buttons are the way in
    if (installed()) return;
    offer = e;
    paint();
  });

  async function install() {
    if (installed()) return;
    if (!offer) return openInstructions();
    const e = offer;
    offer = null; // a prompt can be used once; the browser fires a new event if it may be asked again
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice?.outcome !== "accepted") paint();
    } catch {
      openInstructions();
    }
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-install]");
    if (!b) return;
    e.preventDefault();
    install();
  });
  window.LuneInstall = {
    /** The browser can show its own install prompt right now. */
    available: () => !!offer && !installed(),
    installed,
    install,
    platform,
    openInstructions,
    paint,
  };

  window.addEventListener("appinstalled", () => {
    offer = null;
    paint();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", paint);
  paint();
  // buttons drawn later (Settings, the signed-in home) are painted when they appear
  if (installed()) new MutationObserver(paint).observe(document.body, { childList: true, subtree: true });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {
        /* not served here (e.g. a file preview): the site works as before */
      });
    });
  }

  /*
   * Always the newest Lune. Each publish writes its stamp to deploy-stamp.txt.
   * Opening Lune on an older copy reloads once, straight away; a newer copy
   * published while Lune is open is offered with one tap, never forced
   * mid-practice.
   */
  const mine = (document.querySelector('script[src*="?v="]')?.getAttribute("src") || "").match(/v=([\w-]+)/)?.[1] || "";
  let offered = false;
  async function checkForUpdate(first) {
    if (!mine || offered || !/^https?:$/.test(location.protocol)) return;
    let live = "";
    try {
      const r = await fetch(`deploy-stamp.txt?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      live = (await r.text()).trim();
    } catch {
      return;
    }
    if (!/^[\w-]{3,40}$/.test(live) || live === mine) return;
    const tried = (() => {
      try {
        return sessionStorage.getItem("lune.updated-to");
      } catch {
        return null;
      }
    })();
    if (first && tried !== live) {
      try {
        sessionStorage.setItem("lune.updated-to", live);
      } catch {
        /* private mode */
      }
      const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
      await reg?.update?.().catch(() => {});
      location.reload();
      return;
    }
    offered = true;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "lune-update";
    pill.innerHTML = '<span class="lune-update-dot" aria-hidden="true"></span>A new Lune is ready · Update';
    pill.addEventListener("click", () => location.reload());
    document.body.appendChild(pill);
  }
  window.addEventListener("load", () => setTimeout(() => checkForUpdate(true), 800));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate(false));
  setInterval(() => checkForUpdate(false), 10 * 60 * 1000);
})();
