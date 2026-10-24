# Browser end-to-end checks (puppeteer-core, not a project dependency)
Needs: Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`, backend on :8000, `npm run dev` on :5173, and `npm i puppeteer-core` in a scratch dir.
Run from that scratch dir: `node <repo>/scripts/e2e/qa.mjs` (every tab/interaction) and `node <repo>/scripts/e2e/demo.mjs` (guided demo). `W=1366 H=768` for laptop size.
They use the `?shot` URL flag (exposes `window.__map`). `demo.mjs` calls the real planner (Gemma if `GEMMA_API_KEY` is set).
