import puppeteer from 'puppeteer-core'
const W = +process.env.W || 1440, H = +process.env.H || 900
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage(); await p.setViewport({ width: W, height: H })
const problems = []
p.on('pageerror', e => problems.push('PAGEERROR ' + e.message))
p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/GPU|swiftshader|WebGL|net::ERR_ABORTED/i.test(t)) problems.push('console.error ' + t.slice(0, 160)) } })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); if (!c) problems.push('FAIL ' + n) }
const coach = () => p.evaluate(() => document.querySelector('[aria-label="Guided demo"]')?.innerText ?? null)
const clickBtn = async (txt, scope = 'document') => { const ok = await p.evaluate((txt) => { const el = [...document.querySelectorAll('button')].find(e => e.textContent.trim().includes(txt) && !e.disabled && e.offsetParent !== null); if (!el) return false; el.click(); return true }, txt); if (!ok) problems.push('NOT FOUND/disabled button: ' + txt); await sleep(900); return ok }
const waitCoach = (re, ms = 90000) => p.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('[aria-label="Guided demo"]')?.innerText ?? ''), { timeout: ms }, re.source).catch(() => problems.push('coach never showed ' + re))

await p.goto('http://localhost:5173/?shot', { waitUntil: 'networkidle2' }); await sleep(4000)
check('welcome card on first visit', await p.evaluate(() => !!document.querySelector('[aria-label="Welcome"]')))
await p.screenshot({ path: `demo_${W}_0_welcome.png` })
await clickBtn('Start 5-step guided demo')
check('welcome dismissed + coach visible', !(await p.evaluate(() => !!document.querySelector('[aria-label="Welcome"]'))) && !!(await coach()))
await sleep(1800)
let c = await coach(); console.log('--- step1:', c.replace(/\n/g, ' | ').slice(0, 400))
check('step 1 narration has live closed %', /\d+% of directed road length is closed/.test(c))
check('step 1 selects Cat 3', await p.evaluate(() => document.querySelector('button[aria-checked=true]')?.textContent === 'CAT 3'))
await p.screenshot({ path: `demo_${W}_1.png` })

await clickBtn('Next'); await sleep(2200)
c = await coach(); console.log('--- step2:', c.replace(/\n/g, ' | ').slice(0, 300))
check('step 2 shows zones tab with Historic Downtown selected', /STEP 2\/5/.test(c) && await p.evaluate(() => /HISTORIC DOWNTOWN/i.test([...document.querySelectorAll('aside')].pop().innerText) && /closed \(illustrative\)/i.test([...document.querySelectorAll('aside')].pop().innerText)))
await p.screenshot({ path: `demo_${W}_2.png` })

await clickBtn('Next'); await sleep(1500)
c = await coach(); console.log('--- step3:', c.replace(/\n/g, ' | ').slice(0, 200))
check('step 3 shows modules (medical expanded)', await p.evaluate(() => /medical_access|hospital_origins|medical\./i.test([...document.querySelectorAll('aside')].pop().innerText)))
await p.screenshot({ path: `demo_${W}_3.png` })

await clickBtn('Next')
await sleep(1200)
const busy = await coach(); console.log('--- step4 (busy?):', busy.replace(/\n/g, ' | ').slice(0, 160))
const t0 = Date.now(); await waitCoach(/proposed|fallback plan/); console.log('plan ready after ~' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
c = await coach(); console.log('--- step4 done:', c.replace(/\n/g, ' | ').slice(0, 420))
check('step 4 names real Gemma or labeled fallback', /real gemma response|not a gemma response/i.test(c))
check('Next enabled once plan ready', await p.evaluate(() => { const b = [...document.querySelectorAll('[aria-label="Guided demo"] button')].find(e => /Next/.test(e.textContent)); return !!b && !b.disabled }))
await p.screenshot({ path: `demo_${W}_4.png` })

await clickBtn('Next'); await sleep(4500)
c = await coach(); console.log('--- step5:', c.replace(/\n/g, ' | ').slice(0, 520))
check('step 5 narration shows backend before->after', /nodes with a modeled route to care go/i.test(c) && /→/.test(c))
const gained = await p.evaluate(() => window.__map.querySourceFeatures('reach-gain').length)
check('map shows gained-node layer', gained > 0, String(gained))
const sites = await p.evaluate(() => document.querySelectorAll('button.maplibregl-marker[aria-label*="applied"]:not([aria-label*="not applied"])').length)
check('applied site markers highlighted', sites >= 1, String(sites))
check('camera framed the sites (zoom changed from home)', await p.evaluate(() => { const z = window.__map.getZoom(); return z > 12 && z < 16 }))
await p.screenshot({ path: `demo_${W}_5.png` })

await clickBtn('Back'); await sleep(800); check('Back returns to step 4', /STEP 4\/5/.test(await coach()))
await clickBtn('Next'); await sleep(2500)
await clickBtn('Finish'); await sleep(600)
check('Finish closes coach', (await coach()) === null)
const applied = await p.evaluate(() => /\d+ applied/.exec([...document.querySelectorAll('aside')].pop().innerText)?.[0])
console.log('after finish, applied state persists for free exploration:', applied)

// re-open from header, welcome should not return after reload
await p.reload({ waitUntil: 'networkidle2' }); await sleep(3000)
check('welcome not shown again after dismissal (localStorage)', !(await p.evaluate(() => !!document.querySelector('[aria-label="Welcome"]'))))
await clickBtn('Guided demo'); await sleep(1500); check('header button restarts demo at step 1', /STEP 1\/5/.test(await coach() ?? ''))
// nav steps clickable without demo auto-calling planner
await clickBtn('Exit demo'); await sleep(300)
await p.evaluate(() => [...document.querySelectorAll('nav button')].find(b => /Apply/.test(b.textContent)).click()); await sleep(800)
check('nav step 5 switches to Response tab without side effects', await p.evaluate(() => /Incident Commander/i.test([...document.querySelectorAll('aside')].pop().innerText)))

console.log('\n== PROBLEMS (' + problems.length + ')'); problems.forEach(x => console.log(' -', x))
await b.close()
