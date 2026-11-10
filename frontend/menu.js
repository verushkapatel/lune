/* Lune — shared popover menu.
 * window.LuneMenu.attach(trigger, items)
 * items: array or () => array of
 *   { label, hint?, icon?, action?, disabled?, checked?, hidden?, id?, href?, download?, className? }
 */
window.LuneMenu = (function () {
  const OPEN = new Set();

  function isPaper(trigger) {
    return !!(trigger.closest(".coach") || trigger.closest(".coach-sheet") || trigger.dataset.menuPaper === "1");
  }

  function itemNodes(panel) {
    return [...panel.querySelectorAll("[role='menuitem']")].filter((el) => !el.hidden && el.getAttribute("aria-disabled") !== "true");
  }

  function closePanel(panel) {
    if (!panel) return;
    const trigger = panel._luneTrigger;
    panel.hidden = true;
    panel.classList.remove("is-open");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      if (panel.contains(document.activeElement)) trigger.focus();
    }
    OPEN.delete(panel);
    document.removeEventListener("pointerdown", panel._onDoc, true);
    document.removeEventListener("keydown", panel._onKey, true);
  }

  function closeAll(except) {
    for (const panel of [...OPEN]) {
      if (panel !== except) closePanel(panel);
    }
  }

  function place(panel, trigger) {
    const r = trigger.getBoundingClientRect();
    const pad = 8;
    panel.style.visibility = "hidden";
    panel.hidden = false;
    const w = Math.max(panel.offsetWidth, 180);
    const h = panel.offsetHeight;
    let left = r.right - w;
    let top = r.bottom + 4;
    if (left < pad) left = pad;
    if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
    if (top + h > window.innerHeight - pad && r.top - 4 - h > pad) top = r.top - 4 - h;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.minWidth = `${Math.max(180, Math.round(r.width))}px`;
    panel.style.visibility = "";
  }

  function renderItems(panel, items) {
    panel.textContent = "";
    for (const item of items || []) {
      if (!item || item.hidden) continue;
      const tag = item.href ? "a" : "button";
      const el = document.createElement(tag);
      el.setAttribute("role", "menuitem");
      el.className = `lune-menu-item${item.className ? ` ${item.className}` : ""}`;
      if (item.id) el.id = item.id;
      if (tag === "button") el.type = "button";
      if (item.href) {
        el.href = item.href;
        if (item.download) el.download = item.download;
      }
      if (item.disabled) {
        el.setAttribute("aria-disabled", "true");
        el.tabIndex = -1;
      } else {
        el.tabIndex = -1;
      }
      if (item.checked) el.setAttribute("aria-checked", "true");
      if (item.title) el.title = item.title;
      const check = document.createElement("span");
      check.className = "lune-menu-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = item.checked ? "✓" : "";
      const icon = document.createElement("span");
      icon.className = "lune-menu-icon";
      icon.setAttribute("aria-hidden", "true");
      if (item.icon) icon.innerHTML = item.icon;
      const label = document.createElement("span");
      label.className = "lune-menu-label";
      label.textContent = item.label || "";
      el.appendChild(check);
      if (item.icon) el.appendChild(icon);
      el.appendChild(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "lune-menu-hint";
        hint.textContent = item.hint;
        el.appendChild(hint);
      }
      el.addEventListener("click", (e) => {
        if (item.disabled) {
          e.preventDefault();
          return;
        }
        closePanel(panel);
        if (typeof item.action === "function") {
          e.preventDefault();
          item.action(item, el);
        }
      });
      panel.appendChild(el);
    }
  }

  function openPanel(panel, trigger, getItems) {
    closeAll(panel);
    renderItems(panel, getItems());
    panel.classList.toggle("is-paper", isPaper(trigger));
    place(panel, trigger);
    panel.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    OPEN.add(panel);
    const rows = itemNodes(panel);
    (rows[0] || panel).focus();
    panel._onDoc = (e) => {
      if (panel.contains(e.target) || trigger.contains(e.target)) return;
      closePanel(panel);
    };
    panel._onKey = (e) => {
      if (!OPEN.has(panel)) return;
      const rowsNow = itemNodes(panel);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePanel(panel);
        return;
      }
      if (!rowsNow.length) return;
      const i = rowsNow.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        rowsNow[(i + 1 + rowsNow.length) % rowsNow.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        rowsNow[(i - 1 + rowsNow.length) % rowsNow.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        rowsNow[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        rowsNow[rowsNow.length - 1].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (document.activeElement && panel.contains(document.activeElement)) {
          e.preventDefault();
          document.activeElement.click();
        }
      }
    };
    document.addEventListener("pointerdown", panel._onDoc, true);
    document.addEventListener("keydown", panel._onKey, true);
  }

  function attach(trigger, items) {
    if (!trigger) return { open() {}, close() {}, update() {} };
    trigger._luneGetItems = typeof items === "function" ? items : () => items || [];
    const getItems = () => (typeof trigger._luneGetItems === "function" ? trigger._luneGetItems() : []);
    let panel = trigger._luneMenu;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "lune-menu";
      panel.setAttribute("role", "menu");
      panel.hidden = true;
      panel._luneTrigger = trigger;
      document.body.appendChild(panel);
      trigger._luneMenu = panel;
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      if (!trigger.id) trigger.id = `menu-btn-${Math.random().toString(36).slice(2, 8)}`;
      panel.setAttribute("aria-labelledby", trigger.id);
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = getItems();
        if (!next || !next.length) return;
        if (trigger.getAttribute("aria-expanded") === "true") closePanel(panel);
        else openPanel(panel, trigger, getItems);
      });
      trigger.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" && trigger.getAttribute("aria-expanded") !== "true") {
          e.preventDefault();
          openPanel(panel, trigger, getItems);
        }
      });
    }
    return {
      open: () => openPanel(panel, trigger, getItems),
      close: () => closePanel(panel),
      update: () => {
        if (OPEN.has(panel)) renderItems(panel, getItems());
      },
    };
  }

  return { attach, closeAll };
})();
