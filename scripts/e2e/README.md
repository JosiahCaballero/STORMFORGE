# Browser end-to-end checks (puppeteer-core, not a project dependency)
Needs: Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`, backend on :8000, `npm run dev` on :5173, and `npm i puppeteer-core` in a scratch dir (copy/symlink this folder there so `node_modules` resolves).
- `node qa.mjs`   free exploration: category, region, deploy, before/after numbers vs the API, rejections, inventory limits, move/remove, Compare + Gemma, apply/restore/reset, category reset, layers, How it works.
- `node demo.mjs` the guided 5-step demo end to end, then free exploration afterwards.
Env: `W=1366 H=768` viewport, `OUT=<dir>` for screenshots, `LIVE_PLAN=1` to call the real Gemma planner. By default the plan endpoint is stubbed with a saved real response (`fixtures/plan_cat3_real_gemma.json`) so Gemma quota is not spent.
They use the `?shot` URL flag (exposes `window.__map`).
