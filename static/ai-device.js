/* Lune AI on this device.
 *
 * Runs an open-weight language model inside the visitor's browser, so Ask
 * Lune can use a model with no install, no account, no key and no cost to
 * anyone. Nothing is downloaded until the pianist turns it on, and the size
 * is shown before the download starts. The model then answers from the same
 * system prompt and score context as the Ollama mode (ask.js).
 *
 * The model runs in a worker (ai-worker.js) so the page stays responsive.
 * The weights are kept in the browser's cache ("transformers-cache"); turning
 * Lune AI off deletes them.
 */
window.LuneDeviceAI = (function () {
  /*
   * The model. Sizes are the bytes of the files transformers.js fetches for
   * each build, measured from the Hugging Face repository; see docs/AI.md.
   */
  const MODEL = {
    /*
     * Off until scripts/device_ai_eval.py has passed with this model in a real
     * browser (grounded answers, acceptable speed) and the byte sizes below are
     * measured. Until then Lune offers only its built-in answers and Ollama.
     * For testing, localStorage "lune.ai.device.test" = "1" turns it on.
     */
    verified: false,
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    name: "Qwen2.5 1.5B Instruct",
    maker: "Qwen team, Alibaba Cloud",
    licence: "Apache 2.0",
    builds: {
      webgpu: { dtype: "q4f16", bytes: 0 },
      wasm: { dtype: "q4", bytes: 0 },
    },
  };
  const FLAG = "lune.ai.device";
  // ai-worker.js sits beside this file; carry its ?v= stamp across
  const SELF = document.currentScript?.src || new URL("static/ai-device.js", location.href).href;
  const CACHE = "transformers-cache";

  let worker = null;
  let status = "off"; // off | loading | ready | error
  let device = null;
  let lastError = "";
  let loading = null;
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((fn) => fn(ev));

  const get = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const put = (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: lasts for this visit */
    }
  };

  /** What this browser can run it on. WebGPU is far faster; WebAssembly works everywhere else. */
  let supportProbe = null;
  function support() {
    supportProbe ||= (async () => {
      const wasm = typeof WebAssembly === "object" && typeof Worker === "function";
      let webgpu = false;
      let f16 = false;
      try {
        const adapter = await navigator.gpu?.requestAdapter?.();
        if (adapter) {
          webgpu = true;
          f16 = adapter.features?.has?.("shader-f16") || false;
        }
      } catch {
        /* no WebGPU */
      }
      const mem = navigator.deviceMemory || null; // GB, Chromium only, rounded down
      return { wasm, webgpu, f16, mem };
    })();
    return supportProbe;
  }

  async function plan() {
    const s = await support();
    const forced = get("lune.ai.device.backend");
    const use = forced === "wasm" || !s.webgpu ? "wasm" : "webgpu";
    const build = MODEL.builds[use];
    const dtype = use === "webgpu" && !s.f16 ? "q4" : build.dtype;
    const bytes = use === "webgpu" && dtype === "q4" ? MODEL.builds.wasm.bytes : build.bytes;
    return { ...MODEL, device: use, dtype, bytes, supported: s.wasm && offered(), support: s };
  }

  /** Shown to visitors only once the model has passed its test. */
  const offered = () => MODEL.verified || get("lune.ai.device.test") === "1";

  const sizeText = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

  function ensureWorker() {
    if (worker) return worker;
    const url = new URL("ai-worker.js", SELF);
    url.search = new URL(SELF).search;
    worker = new Worker(url, { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "progress") emit({ type: "progress", loaded: m.loaded, total: m.total, file: m.file });
      else if (m.type === "ready") {
        status = "ready";
        emit({ type: "ready", ms: m.ms, device: m.device });
      } else if (m.type === "token") pending.get(m.id)?.onToken?.(m.text);
      else if (m.type === "done") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        p?.resolve(m);
      } else if (m.type === "error") {
        if (m.id != null && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          p.reject(new Error(m.message));
        } else {
          status = "error";
          lastError = m.message;
          emit({ type: "error", message: m.message });
        }
      }
    };
    worker.onerror = (e) => {
      status = "error";
      lastError = e.message || "The model could not start in this browser";
      emit({ type: "error", message: lastError });
    };
    return worker;
  }

  /** Download (first time) or load from the browser cache, then keep it in memory. */
  function load() {
    if (status === "ready") return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      const p = await plan();
      if (!p.supported) throw new Error("This browser cannot run a model");
      device = p.device;
      status = "loading";
      lastError = "";
      emit({ type: "loading", device });
      await new Promise((resolve, reject) => {
        const off = (fn) => listeners.delete(fn);
        const watch = (ev) => {
          if (ev.type === "ready") {
            off(watch);
            resolve();
          } else if (ev.type === "error") {
            off(watch);
            reject(new Error(ev.message));
          }
        };
        listeners.add(watch);
        ensureWorker().postMessage({ type: "load", model: p.id, dtype: p.dtype, device: p.device });
      });
      put(FLAG, "on");
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** Ask the model. Loads it first if this visit has not yet. */
  async function chat(messages, { maxTokens = 320, onToken } = {}) {
    await load();
    const id = ++seq;
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onToken });
      worker.postMessage({ type: "generate", id, messages, maxTokens });
    });
    return res;
  }

  async function turnOff() {
    put(FLAG, null);
    status = "off";
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    worker = null;
    pending.clear();
    try {
      await caches.delete(CACHE);
    } catch {
      /* no Cache API */
    }
    emit({ type: "off" });
  }

  const enabled = () => offered() && get(FLAG) === "on";

  /*
   * "Now superpowered with Lune AI" on the landing page and signed-in home.
   * It stays hidden until the model has passed its test (MODEL.verified), and
   * says on the same screen that the model runs on the device and what it downloads.
   */
  async function paintNews() {
    const boxes = document.querySelectorAll("[data-ai-news]");
    if (!boxes.length) return;
    const p = await plan();
    const show = offered() && p.supported && p.bytes > 0;
    for (const box of boxes) {
      box.hidden = !show;
      if (!show) continue;
      const fine = box.querySelector("[data-ai-news-fine]");
      if (fine) {
        fine.textContent = `It runs on your device, not on a server: nothing you ask leaves it. Turning it on downloads ${sizeText(p.bytes)} once (${p.name}, an open-weight model, ${p.licence} licence). It is free, needs no account, and is off until you turn it on.`;
      }
      const btn = box.querySelector("[data-ai-news-open]");
      if (btn) btn.textContent = enabled() ? "Lune AI is on" : "Turn on Lune AI";
    }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-ai-news-open]")) return;
    // Settings has the switch, the size and the way to turn it off again
    document.getElementById("btn-settings")?.click();
    setTimeout(() => document.getElementById("set-device-ai")?.scrollIntoView({ block: "center" }), 120);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintNews, { once: true });
  else paintNews();

  return {
    MODEL,
    paintNews,
    plan,
    support,
    sizeText,
    load,
    chat,
    turnOff,
    /** Turned on earlier on this device (the weights are in the cache). */
    enabled,
    offered,
    status: () => status,
    device: () => device,
    lastError: () => lastError,
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
})();
