# Ask Lune and Lune AI

Lune never needs a paid AI service and never holds an API key.

## Two modes

**No model connected (the default).** Ask Lune works from its built-in rules
in `frontend/ask.js`: it reads Lune's analysis of the open score and your
remarks, saves remarks, logs how a bar went and writes plans. Nothing is sent
anywhere. The panel says "Local model not connected" and calls these built-in
answers. They are never presented as a language model's.

**Local model connected.** A language model running on your own computer
answers questions, through `LuneAIProvider` in the same file. Lune sends it:

- the system prompt (`SYSTEM_PROMPT`), which forbids inventing notes,
  fingerings, bars, dynamics, tempo marks or composer intentions;
- a structured context built for that question by `buildContext()`: piece
  facts, the bar and its neighbours, fingering, difficulty, your remarks,
  your earlier questions, your ratings and the bars you keep finding hard,
  your plans, your goal and the tempo you are practising at;
- your question, or a task instruction (`explainBar`, `explainFingering`,
  `suggestPractice`, `generatePracticePlan`, `summarizePractice`, …).

Remarks, ratings and plans are still written by the built-in rules, so a
model cannot invent or lose them. If the model does not answer, the built-in
answer is shown and labelled as such.

No model has been trained or fine-tuned for Lune. The answers are specific to
Lune because of the context it supplies.

## Setting up a local model (free)

1. Install [Ollama](https://ollama.com) and open it.
2. Fetch a model: `ollama pull llama3.2` (about 2 GB, quick). `qwen2.5:7b`
   (about 5 GB) follows instructions more carefully and is slower.
3. Let the site reach it. Quit Ollama, then start it with the site's origin
   allowed: `OLLAMA_ORIGINS=https://lune.page ollama serve`
4. In Lune: Settings → Ask Lune → "Use Ollama on this computer" → Test.

The address (`http://localhost:11434/v1/chat/completions`) and the model name
are editable, so any runtime with an OpenAI-compatible chat endpoint works.
It only works on the computer running the model: a phone has no Ollama.

## Why there is no AI for every visitor

Lune is a static site. A model for every visitor would need a server paying
for inference. `serverless/lune-ai-proxy.js` shows how such a server would
hold a key outside the browser, but it is not deployed, not required and not
part of the product.

## What has been tested

Against a stand-in server speaking the same protocol: the request (system
prompt, context, model name, no credentials), showing the answer, naming the
model in the panel, the task methods, and falling back when the model fails.
It has not been run against a real model: Ollama is not installed on the
machine where Lune was built.
