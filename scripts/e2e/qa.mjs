import puppeteer from 'puppeteer-core'
const W = +process.env.W || 1440, H = +process.env.H || 900
const out = (n) => `qa_${W}_${n}.png`
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage(); await p.setViewport({ width: W, height: H })
const problems = []
p.on('pageerror', e => problems.push('PAGEERROR ' + e.message))
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/GPU stall|swiftshader|WebGL/i.test(t)) problems.push(`console.${m.type()} ${t.slice(0, 160)}`) } })
p.on('requestfailed', r => problems.push('REQFAILED ' + r.url().slice(0, 100)))
p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`) })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const txt = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map(e => e.innerText).join('\n'), sel)
const rightText = () => p.evaluate(() => { const a = [...document.querySelectorAll('aside')]; return (a[a.length - 1]?.innerText || '') })
const clickText = async (sel, t, scope = '') => {
  const ok = await p.evaluate((sel, t, scope) => {
    const root = scope ? document.querySelector(scope) : document
    const el = [...root.querySelectorAll(sel)].find(e => e.textContent.trim().toLowerCase().replace(/^\d+/, '').replace(/^[^a-z0-9]+/i, '').startsWith(t.toLowerCase()) && e.offsetParent !== null)
    if (!el) return false; el.click(); return true
  }, sel, t, scope)
  if (!ok) problems.push(`NOT FOUND: ${sel} "${t}"`)
  await sleep(900); return ok
}
const step = (n) => console.log('\n== ' + n)
const check = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')) || (!cond && problems.push('FAIL ' + name))

await p.goto('http://localhost:5173/?shot', { waitUntil: 'networkidle2' }); await sleep(4500)
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /Explore on my own/.test(b.textContent))?.click()); await sleep(500)
step('1 initial load')
check('map canvas rendered', await p.evaluate(() => { const c = document.querySelector('.maplibregl-canvas'); return !!c && c.height > 100 }))
check('no backend-down banner', !(await rightText()).includes('Backend not reachable'))
await p.screenshot({ path: out('01_load') })

step('2 category switching')
const kpi = async () => (await rightText()).match(/CLOSED · DIRECTED LENGTH\s*\n?\s*([\d.]+)/i)?.[1]
const vals = []
for (const k of ['0', '1', '2', '3', '4', '5']) { await p.keyboard.press(k); await sleep(700); vals.push(await kpi()) }
console.log('closed % by cat 0..5:', vals.join(', '))
check('closed% strictly increases cat1..5', vals.slice(1).every((v, i, a) => i === 0 || +v > +a[i - 1]))
await clickText('button[role=radio]', 'CAT 2'); check('click CAT 2 sets selected', (await p.evaluate(() => document.querySelector('button[aria-checked=true]')?.textContent)) === 'CAT 2')
await clickText('aside button', 'CAT 3', 'aside:last-of-type'); // comparison bar click
await p.keyboard.press('3'); await sleep(500)
const modeBtn = await clickText('button', 'Route to hospital'); await sleep(500)
check('compare toggle to hospital access shows 0% at cat3', /CAT 3[\s\S]{0,40}0%/.test(await rightText()))
await p.screenshot({ path: out('02_cats') })

step('3 road inspector')
const road = await p.evaluate(async () => { const fc = await (await fetch('/data/roads.geojson')).json(); const f = fc.features.find(f => f.properties.name === 'Cathedral Place' || f.properties.hw === 'primary'); const cs = f.geometry.coordinates; return cs[Math.floor(cs.length / 2)] })
await p.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 17.5, pitch: 0, bearing: 0 }), road); await sleep(2500)
let hit = false
{
  const pt = await p.evaluate((c) => { const q = window.__map.project(c); return [q.x, q.y] }, road)
  console.log('click at', pt.map(Math.round).join(','))
  await p.mouse.click(pt[0], pt[1]); await sleep(900)
  hit = (await rightText()).includes('ROAD SEGMENT')
}
check('clicking map selects a road and opens inspector', hit)
if (hit) { const t = await rightText(); check('inspector lists CAT 1..5 rows', ['CAT 1', 'CAT 2', 'CAT 3', 'CAT 4', 'CAT 5'].every(c => t.includes(c))); await p.screenshot({ path: out('03_inspector') }) }
await p.keyboard.press('Escape'); await sleep(400)
check('Escape clears inspector', !(await rightText()).includes('ROAD SEGMENT'))
await p.evaluate(() => window.__map.jumpTo({ center: [-81.3095, 29.8895], zoom: 14.1, pitch: 28, bearing: -12 })); await sleep(1500)

step('4 zones tab')
await clickText('button[role=tab]', 'Zones')
for (const z of ['Historic Downtown', 'Lincolnville', 'Davis Shores', 'Uptown', 'West Augustine', 'Bridge Corridor']) {
  await clickText('aside button', z, 'aside:last-of-type'); await sleep(900)
  const t = await rightText()
  check(`zone "${z}" impact panel loads`, /CLOSED \(ILLUSTRATIVE\)|Closed \(illustrative\)/i.test(t) && /nodes/i.test(t), (t.match(/(\d+)%/g) || []).slice(0, 2).join(' '))
}
await p.screenshot({ path: out('04_zone') })
// click zone label on map
const labelClicked = await p.evaluate(() => { const el = [...document.querySelectorAll('.maplibregl-marker')].find(e => /historic downtown/i.test(e.textContent)); if (!el) return false; el.click(); return true })
check('map zone label is clickable', labelClicked)

step('5 modules tab')
await clickText('button[role=tab]', 'Modules')
for (const a of ['Transportation', 'Medical', 'Logistics', 'Community']) {
  await clickText('aside button', a, 'aside:last-of-type'); await sleep(500)
  const t = await rightText(); check(`${a} module expands with findings`, /\.[a-z_]+ ·/.test(t) || /simulated/i.test(t))
}
check('transit marked planned', /planned/i.test(await rightText()))
await p.screenshot({ path: out('05_modules') })

step('6 response tab: apply/remove + evaluate')
await p.keyboard.press('3'); await clickText('button[role=tab]', 'Response'); await sleep(1500)
const before = await rightText()
check('candidates listed', /hypothetical staging/i.test(before))
const anyCare = (t) => (t.match(/Any modeled care route\s*\n?\s*(\d+) → (\d+)/) || []).slice(1).join('→')
console.log('before apply:', anyCare(before))
await clickText('button', 'Apply', 'aside:last-of-type'); await sleep(1500)
const afterTxt = await rightText(); console.log('after apply#1:', anyCare(afterTxt))
check('apply updates Before/After', /1 applied/i.test(afterTxt))
// apply via map marker click
const mk = await p.evaluate(() => { const m = [...document.querySelectorAll('button.maplibregl-marker[aria-label*="hypothetical staging"]')]; return m.length })
check('candidate markers on map', mk >= 5, String(mk))
await p.screenshot({ path: out('06_apply') })
await clickText('button', 'Remove', 'aside:last-of-type'); await sleep(1200)
check('remove restores 0 applied', /0 applied/i.test(await rightText()))

step('7 generate plan')
const t0 = Date.now(); await clickText('button', 'Generate response plan', 'aside:last-of-type')
console.log("busy-state text (informational; instant if server cache hit):", /analysing/i.test(await rightText()))
await p.waitForFunction(() => /real gemma response|not a gemma response/i.test([...document.querySelectorAll('aside')].pop().innerText), { timeout: 120000 }).catch(() => problems.push('plan did not complete in 120s'))
const pt = await rightText(); console.log('plan latency ~', ((Date.now() - t0) / 1000).toFixed(1) + 's')
check('plan shows source label', /real gemma response|not a gemma response/i.test(pt), (pt.match(/Real Gemma response[^\n]*|Deterministic demo fallback[^\n]*/) || [''])[0])
check('verified-by-NetworkX block', /verified by networkx/i.test(pt))
check('zone impact shown', /Zone impact of this plan/i.test(pt))
await p.screenshot({ path: out('07_plan') })
await clickText('button', 'Apply plan', 'aside:last-of-type'); await sleep(1500)
const ap = await rightText(); check('Apply plan applies recommended sites', !/ 0 applied/i.test(ap), (ap.match(/\d+ applied/) || [])[0])
await p.screenshot({ path: out('08_plan_applied') })
await clickText('button', 'Clear', 'aside:last-of-type'); await sleep(900)
check('Clear removes applied', /0 applied/i.test(await rightText()))
await clickText('button', 'used', 'aside:last-of-type'); await sleep(800)
check('citation chip jumps to Modules tab', /ANALYSIS MODULES/i.test(await rightText()))

step('8 category 0 and category change invalidates plan')
await p.keyboard.press('0'); await clickText('button[role=tab]', 'Response'); await sleep(1000)
const t0txt = await rightText(); check('cat 0: generate disabled with guidance', /Select a hurricane category/i.test(t0txt))
await p.keyboard.press('4'); await sleep(900); check('cat change clears stale plan', !/verified by networkx/i.test(await rightText()))

step('9 panels, modal, demo nav')
await clickText('button[aria-label="Toggle right panel"]', ''); await sleep(500)
check('right panel collapses', !(await p.evaluate(() => document.querySelectorAll('aside').length === 1 ? false : true)) || (await p.evaluate(() => document.querySelectorAll('aside').length)) === 1)
await p.screenshot({ path: out('09_collapsed') })
await p.evaluate(() => document.querySelector('button[aria-label="Toggle right panel"]').click()); await sleep(400)
await p.evaluate(() => document.querySelector('button[aria-label="Toggle left panel"]').click()); await sleep(400)
check('left panel collapses', (await p.evaluate(() => document.querySelectorAll('aside').length)) === 1)
await p.evaluate(() => document.querySelector('button[aria-label="Toggle left panel"]').click()); await sleep(400)
await clickText('button', 'Methodology'); check('methodology modal opens', await p.evaluate(() => !!document.querySelector('[role=dialog]')))
await p.screenshot({ path: out('10_method') })
await p.keyboard.press('Escape'); await sleep(400); check('Escape closes modal', await p.evaluate(() => !document.querySelector('[role=dialog]')))
for (const s of ['Select storm', 'Inspect communities', 'Module findings', 'Gemma plan', 'Apply']) { await clickText('nav button', s); }
check('demo nav reaches response tab', /Incident Commander/i.test(await rightText()))

step('10 locate hospital + facility panel')
await clickText('button', 'Locate hospital'); await sleep(2200)
const fac = await p.evaluate(() => { const m = document.querySelector('button.maplibregl-marker[aria-label*="Flagler"]'); if (m) { m.click(); return true } return false })
check('hospital marker clickable', fac); await sleep(500)
await clickText('button[role=tab]', 'Impact'); await sleep(500)
check('facility panel says provisional/unverified', /provisional/i.test(await rightText()) && /not verified|unverified/i.test(await rightText()))
await p.screenshot({ path: out('11_facility') })

console.log('\n== PROBLEMS (' + problems.length + ')'); problems.forEach(x => console.log(' -', x))
await b.close()
