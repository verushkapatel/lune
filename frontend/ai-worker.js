/* Lune AI on this device: the worker that runs the model.
 *
 * Loaded only after the pianist turns Lune AI on in Settings or Ask Lune.
 * It runs an open-weight language model inside the browser with
 * transformers.js (Apache 2.0, pinned version, from the jsDelivr CDN; the
 * library fetches its ONNX Runtime WebAssembly from there too), on the graphics
 * card through WebGPU when the browser has it, otherwise on the processor
 * through WebAssembly. The weights are downloaded once from Hugging Face and
 * kept in the browser's cache. Questions and answers never leave the device.
 *
 * Messages in:  {type:"load", model, dtype, device}
 *               {type:"generate", id, messages, maxTokens}
 * Messages out: {type:"progress", file, loaded, total}
 *               {type:"ready", device, dtype, ms}
 *               {type:"token", id, text}
 *               {type:"done", id, text, tokens, ms}
 *               {type:"error", id?, message}
 */
import { env, pipeline, TextStreamer } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let generator = null;
let loaded = null;

async function load({ model, dtype, device }) {
  const t0 = performance.now();
  const files = new Map();
  generator = await pipeline("text-generation", model, {
    dtype,
    device,
    progress_callback: (p) => {
      if (p.status !== "progress" || !p.file) return;
      files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
      let loadedBytes = 0;
      let totalBytes = 0;
      for (const f of files.values()) {
        loadedBytes += f.loaded;
        totalBytes += f.total;
      }
      postMessage({ type: "progress", file: p.file, loaded: loadedBytes, total: totalBytes });
    },
  });
  loaded = { model, dtype, device };
  postMessage({ type: "ready", device, dtype, ms: Math.round(performance.now() - t0) });
}

async function generate({ id, messages, maxTokens }) {
  if (!generator) throw new Error("The model is not loaded");
  const t0 = performance.now();
  let tokens = 0;
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      tokens += 1;
      postMessage({ type: "token", id, text });
    },
  });
  const out = await generator(messages, {
    max_new_tokens: maxTokens || 320,
    do_sample: false,
    repetition_penalty: 1.1,
    streamer,
  });
  const last = out?.[0]?.generated_text;
  const text = Array.isArray(last) ? last[last.length - 1]?.content || "" : String(last || "");
  postMessage({ type: "done", id, text: text.trim(), tokens, ms: Math.round(performance.now() - t0) });
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === "load") {
      if (loaded && loaded.model === msg.model && loaded.dtype === msg.dtype && loaded.device === msg.device) {
        postMessage({ type: "ready", device: loaded.device, dtype: loaded.dtype, ms: 0 });
      } else await load(msg);
    } else if (msg.type === "generate") await generate(msg);
  } catch (err) {
    postMessage({ type: "error", id: msg.id, message: String(err?.message || err) });
  }
};
