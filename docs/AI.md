# Ask Lune and Lune AI

Ask Lune answers questions about a score, keeps remarks on bars, logs how a bar went and makes practice plans. Everything it says is worked out from Lune's reading of the open score and from what the pianist has written or rated. It costs nothing to run: there is no paid API and no API key anywhere in Lune.

There are three ways an answer can be made. All three go through one interface, `LuneAIProvider`, in `frontend/ask.js`.

## 1. Built-in answers (always on)

A rule-based assistant in the browser. It reads the analysis Lune already has for each bar (notes, fingering, difficulty, dynamics, harmony, advice) and the pianist's remarks and ratings. It is not a language model and Lune never calls it one. It sends nothing anywhere.

Anything that changes data is always done by these rules, whichever mode is on: saving a remark, logging a rating, saving a plan. A model can never invent or lose them.

## 2. Your own model with Ollama (optional)

If Ollama runs on the pianist's computer, Ask Lune can send questions to it. Settings has the steps: install Ollama, `ollama pull llama3.2`, start it with `OLLAMA_ORIGINS` set to the site, then press "Use Ollama on this computer" and Test. Any OpenAI-compatible chat address works the same way. A hosted model would need a proxy that adds its key on the server; Lune never holds one.

This mode has been tested only against a stand-in server (`scripts/standin_model_server.py`), not a real Ollama install.

## 3. Lune AI for account holders (the main way)

Anyone with a free Lune account gets Lune AI in Ask Lune, with nothing to download or install. Guests are invited to make an account.

The model is Llama 3.3 70B Instruct, with Llama 3.1 8B Instruct as the fallback when the larger one is busy or fails (Meta, open weights, Llama 3.3 and 3.1 Community Licenses, so the credits say "Built with Llama"). Both run on Cloudflare Workers AI, called from a small Cloudflare Worker in `workers/lune-ai`. It costs nothing inside Workers AI's free daily allowance of 10,000 neurons. The 70B model is far better at teaching but uses that allowance much faster: as a rough estimate from Cloudflare's published rates, about 140 neurons per question, so around 70 questions a day across everyone (the 8B model alone allowed about 500). The fallback does not stretch the allowance, because both models draw on it. When the allowance runs out, Ask Lune says so and gives its built-in answer until the next day. To trade quality for volume, set `MODEL` in `workers/lune-ai/wrangler.toml` back to `@cf/meta/llama-3.1-8b-instruct-fast`.
There is no API key: the Worker reaches the model through its AI binding.

The Worker:

- checks every request against Supabase. The browser sends the account's access token, and the Worker asks Supabase whether it is valid (with the public anon key). No account, no answer.
- allows at most 10 questions a minute per account.
- holds the system prompt itself, so the service cannot be used as a general chatbot.
- sends the model the score context Ask Lune built and the question, and stores nothing.

Questions leave the pianist's device and go to Cloudflare. Ask Lune, Settings and the landing card say so.

To put it live, run `scripts/deploy_lune_ai.sh` once on a computer with Node.js and a free Cloudflare account. It tests the Worker, deploys it, writes its address into `frontend/lune-config.js` (`aiServer`), and publishes. Until `aiServer` is set, nothing about Lune AI shows on the site. Once it is set, the landing page and signed-in home say "Now superpowered with Lune AI".

Tests: `node workers/lune-ai/test.mjs` checks the Worker itself (accounts, limits, prompt, errors). `scripts/lune_cloud_test.py account` runs the real Worker code locally (`workers/lune-ai/local-server.mjs`, with a stand-in model) behind the website.

## 4. Lune AI on this device (built, switched off)

An open-weight model that runs inside the browser with transformers.js, on the graphics card through WebGPU where the browser has it and on the processor through WebAssembly otherwise. Nothing downloads until the pianist turns it on, and the size is shown first. The weights come from Hugging Face and stay in the browser's cache; turning it off deletes them. The model is a general one, given Lune's reading of the score. It was not trained for Lune.

Files: `frontend/ai-device.js` (download, cache, status) and `frontend/ai-worker.js` (runs the model off the main thread). transformers.js 4.3.0 is loaded from jsDelivr at a pinned version. It is not copied into the repository because GitHub's secret scanner reads a class name in the minified library as an API key and refuses the push.

The planned model is Qwen2.5 1.5B Instruct (Apache 2.0, `onnx-community/Qwen2.5-1.5B-Instruct`).

It is switched off (`MODEL.verified = false` in `ai-device.js`) because it has not yet been tested with the real model. The cloud environment this was built in could not reach huggingface.co or cdn.jsdelivr.net. Visitors see only the built-in answers and the Ollama option until it passes. For testing, `localStorage["lune.ai.device.test"] = "1"` shows it.

### Turning it on

1. Serve the site on port 8137 and run `python3 scripts/device_ai_eval.py webgpu` (and `wasm`) somewhere that can reach Hugging Face.
2. It prints the bytes each build downloads. Put them in `MODEL.builds` in `ai-device.js`.
3. It asks grounded questions through the same system prompt and `buildContext()` as Ask Lune, and checks that note names, bar numbers and fingers in each answer come from the context, that a missing fact is declined and that the model never claims to have heard the pianist. It also times loading and answering.
4. Only if every check passes and answers come back in under 20 seconds, set `verified: true`. If the 1.5B model is too slow on the processor, try `onnx-community/Qwen2.5-0.5B-Instruct` and run the evaluation again. If neither is good enough, leave it off.

This in-browser mode is kept as an option but is not used: Lune AI is offered through accounts instead, so nobody has to download a model.

## What a model is given

The system prompt (`SYSTEM_PROMPT` in `ask.js`) tells the model to use only the score facts in CONTEXT, keep facts apart from suggestions, treat remarks as the pianist's own words, never claim to have heard a performance, say when it does not know, and answer in plain text.

`buildContext(bar)` gives it the piece's title, composer, key, time signature, tempo, era and hardest bars; the pianist's goal; their remarks, ratings and plans for that bar or piece; their earlier questions; and, for one bar, its notes and fingering by hand, difficulty and reasons, dynamics, harmony and Lune's advice, with the bars either side.

## Model actions

With a model connected (Ollama, or Lune AI once it is on), these get chips in Ask Lune and a Lune AI row in the bar panel: Explain this bar, Why is this hard?, Suggest practice and Explain the fingering for a selected bar, and Summarise my practice for the whole piece. Without a model they are hidden, and the built-in chips stay. If a model fails, the built-in answer is shown with a note saying so.
