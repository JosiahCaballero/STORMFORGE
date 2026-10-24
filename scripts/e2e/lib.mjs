// Shared puppeteer helpers for the STORMFORGE e2e scripts. Run from a scratch dir that has puppeteer-core installed.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const W = +process.env.W || 1366, H = +process.env.H || 768
export const OUT = process.env.OUT || process.cwd()
const here = path.dirname(fileURLToPath(import.meta.url))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ stubPlan = process.env.LIVE_PLAN !== '1' } = {}) {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const p = await b.newPage(); await p.setViewport({ width: W, height: H })
  const problems = []
  p.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/GPU stall|swiftshader|WebGL|net::ERR_ABORTED|Failed to load resource/i.test(t)) problems.push('console.error ' + t.slice(0, 200)) } })
  p.on('requestfailed', (r) => { if (!/basemaps\.cartocdn|net::ERR_ABORTED/.test(r.url() + (r.failure()?.errorText ?? ''))) problems.push('REQFAILED ' + r.url().slice(0, 100)) })
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon|cartocdn/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`) })
  const stats = { planCalls: 0 }
  if (stubPlan) {
    const fixture = fs.readFileSync(path.join(here, 'fixtures', 'plan_cat3_real_gemma.json'), 'utf8')
    await p.setRequestInterception(true)
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/v1/allocation/plan')) { stats.planCalls++; setTimeout(() => req.respond({ status: 200, contentType: 'application/json', body: fixture }), 1500) }
      else req.continue()
    })
  }
  const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); if (!c) problems.push('FAIL ' + n) }
  const shot = (n) => p.screenshot({ path: path.join(OUT, `${n}_${W}.png`) })
  const click = async (sel, re, wait = 700) => {
    const ok = await p.evaluate((sel, src) => { const r = new RegExp(src, 'i'); const el = [...document.querySelectorAll(sel)].find((e) => r.test(e.getAttribute('aria-label') || e.textContent) && !e.disabled && e.offsetParent !== null); if (!el) return false; el.click(); return true }, sel, re.source)
    if (!ok) problems.push(`NOT FOUND/disabled: ${sel} ${re}`)
    await sleep(wait); return ok
  }
  const text = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText).join('\n'), sel)
  const panel = () => text('aside')
  const toast = () => p.evaluate(() => document.querySelector('[role=status].toast-in')?.innerText ?? '')
  const waitFor = (fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms }, arg).then(() => true).catch(() => false)
  const api = (url, body) => p.evaluate(async (url, body) => (await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json(), url, body)
  const open = async (explore = true) => {
    await p.goto('http://localhost:5173/?shot', { waitUntil: 'networkidle2' })
    await waitFor(() => !!document.querySelector('[aria-label=Welcome]') || document.querySelector('aside'), null, 20000)
    if (explore) { await click('button', /Explore on my own/, 500) }
    await waitFor(() => /Neighborhoods needing attention/.test(document.querySelector('aside')?.innerText ?? ''), null, 40000)
    await sleep(2500)
  }
  const done = async () => { console.log('\n== PROBLEMS (' + problems.length + ')'); problems.forEach((x) => console.log(' -', x)); await b.close(); process.exitCode = problems.length ? 1 : 0 }
  return { b, p, problems, check, shot, click, text, panel, toast, waitFor, api, open, done, stats }
}
