/* Lune — install.
 *
 * Registers the service worker (sw.js beside index.html) and wires the
 * landing page's "Install Lune" button. The button stays hidden until the
 * browser itself says the site can be installed (beforeinstallprompt), and
 * pressing it opens the browser's own install prompt — nothing of Lune's.
 * Browsers without that event (iOS Safari) never see the button; their Share
 * menu's Add to Home Screen is unchanged.
 */
(function () {
  const btn = document.getElementById("btn-install");
  const installed = () =>
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  let offer = null;

  const show = (on) => {
    if (btn) btn.hidden = !on;
  };

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no browser mini-banner; the button is the one way in
    if (installed()) return;
    offer = e;
    show(true);
  });

  async function install() {
    if (!offer) return;
    const e = offer;
    offer = null; // a prompt can be used once; the browser fires a new event if it may be asked again
    show(false);
    try {
      await e.prompt();
    } catch {
      /* prompt already used or dismissed */
    }
  }
  btn?.addEventListener("click", install);
  // The More menu offers the same thing to people who are signed in.
  window.LuneInstall = { available: () => !!offer && !installed(), install };

  window.addEventListener("appinstalled", () => {
    offer = null;
    show(false);
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", (m) => {
    if (m.matches) show(false);
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* not served here (e.g. a file preview): the site works as before */
      });
    });
  }
})();
