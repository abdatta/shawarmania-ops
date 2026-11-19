/**
 * The Send batch page, as text (design D7).
 *
 * One page with a little script: every two seconds it asks the sender for its
 * state (`/state`) and redraws. It shows what the sender is doing, India's
 * time, the batch that is waiting with how many went out today and when the
 * last batch finished, and one button. Pressing it posts the token the page
 * was served with; see `control-page-server.ts` for why that is enough.
 *
 * Everything the page shows is put in as text, never as markup, so a
 * campaign's name cannot become part of the page.
 */

export function controlPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shawarmania sender</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f3ee; --card: #ffffff; --ink: #1f1a17; --muted: #6b625b;
    --line: #e4ddd3; --accent: #9a3412; --accent-ink: #ffffff; --ok: #166534; --alarm: #b91c1c; --warn: #b45309; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171310; --card: #221c18; --ink: #f4ede4;
    --muted: #a99d92; --line: #3a312b; --accent: #ea7a3c; --accent-ink: #1a120c; --ok: #4ade80; --alarm: #f87171; --warn: #fbbf24; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, "Segoe UI", sans-serif; }
  main { max-width: 34rem; margin: 0 auto; padding: 28px 18px 48px; }
  h1 { font-size: 15px; font-weight: 600; color: var(--muted); margin: 0 0 18px; letter-spacing: .02em; }
  .state { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 650; margin-bottom: 4px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted); flex: none; }
  .sub { color: var(--muted); margin: 0 0 20px 22px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 14px; }
  .card h2 { font-size: 17px; margin: 0 0 6px; }
  .card p { margin: 2px 0; color: var(--muted); }
  .action { border-left: 5px solid var(--warn); }
  .alarm { border-left: 5px solid var(--alarm); }
  .done { border-left: 5px solid var(--ok); }
  button { font: inherit; font-weight: 650; border: 0; border-radius: 10px; padding: 12px 22px; margin-top: 14px;
    background: var(--accent); color: var(--accent-ink); cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .tile b { display: block; font-size: 22px; }
  .tile span { color: var(--muted); font-size: 13px; }
  .said { margin-top: 10px; font-weight: 600; }
  .rehearsal { color: var(--warn); font-weight: 600; margin-bottom: 14px; }
  [hidden] { display: none !important; }
</style>
<main>
  <h1>Shawarmania sender</h1>
  <p class="rehearsal" id="rehearsal" hidden>Rehearsal. Messages go to your own test number and nobody else.</p>
  <div class="state"><span class="dot" id="dot"></span><span id="headline">Starting</span></div>
  <p class="sub" id="sub"></p>

  <section class="card action" id="waiting" hidden>
    <h2 id="waiting-title"></h2>
    <p id="waiting-who"></p>
    <button id="send">Send batch</button>
    <p class="said" id="said" hidden></p>
  </section>

  <section class="card" id="notice" hidden>
    <h2 id="notice-title"></h2>
    <div id="notice-lines"></div>
  </section>

  <div class="tiles">
    <div class="tile"><b id="sent-today">-</b><span>sent today</span></div>
    <div class="tile"><b id="last-batch">-</b><span>last batch finished</span></div>
    <div class="tile"><b id="this-run">0</b><span>sent since it started</span></div>
  </div>
  <p class="sub" id="trouble" style="margin-left:0"></p>
</main>
<script>
  const TOKEN = ${JSON.stringify(token)}
  const COLOURS = { connecting: 'var(--muted)', idle: 'var(--muted)', waiting_for_you: 'var(--warn)',
    sending: 'var(--ok)', outside_hours: 'var(--muted)', held: 'var(--warn)', database_unreachable: 'var(--alarm)',
    stood_down: 'var(--muted)', halted: 'var(--alarm)', stopped: 'var(--muted)' }
  const $ = (id) => document.getElementById(id)
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const india = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
  let pressed = false

  function draw(view) {
    $('rehearsal').hidden = !view.rehearsal
    $('dot').style.background = COLOURS[view.mood] || 'var(--muted)'
    $('headline').textContent = view.headline
    let sub = 'It is ' + india() + ' in India.'
    if (view.windowOpensAt) sub += ' The sending window opens at ' + clock(view.windowOpensAt) + ' your time.'
    $('sub').textContent = sub

    const waiting = view.waiting
    $('waiting').hidden = !waiting
    if (waiting) {
      $('waiting-title').textContent = 'Batch ' + waiting.batchNo + ' is waiting'
      $('waiting-who').textContent = '\\u201c' + waiting.campaignName + '\\u201d \\u00b7 ' + waiting.recipients + ' people'
      if (!pressed) { $('send').disabled = false; $('said').hidden = true }
    } else {
      pressed = false
    }

    const notice = view.notice
    $('notice').hidden = !notice
    if (notice) {
      $('notice').className = 'card ' + notice.tone
      $('notice-title').textContent = notice.title
      $('notice-lines').replaceChildren(...notice.lines.map((line) => {
        const p = document.createElement('p'); p.textContent = line; return p }))
    }

    $('sent-today').textContent = view.sentToday === null ? '-' : view.sentToday
    $('last-batch').textContent = view.lastBatchFinishedAt ? clock(view.lastBatchFinishedAt) : '-'
    $('this-run').textContent = view.thisRun.sent
    const t = view.thisRun
    const trouble = [t.failed && t.failed + ' failed', t.unsure && t.unsure + ' unsure',
      t.notOnWhatsApp && t.notOnWhatsApp + ' not on WhatsApp'].filter(Boolean)
    $('trouble').textContent = trouble.length ? 'Since it started: ' + trouble.join(', ') + '.' : ''
  }

  async function refresh() {
    try {
      draw(await (await fetch('/state', { cache: 'no-store' })).json())
    } catch {
      $('dot').style.background = 'var(--alarm)'
      $('headline').textContent = 'The sender is not running'
      $('sub').textContent = 'This page will come back by itself when it starts.'
      $('waiting').hidden = true
    }
  }

  $('send').addEventListener('click', async () => {
    pressed = true
    $('send').disabled = true
    let said = 'Could not reach the sender.'
    try {
      const answer = await fetch('/release', { method: 'POST', headers: { 'x-sender-token': TOKEN } })
      said = (await answer.json()).message
    } catch {}
    $('said').textContent = said
    $('said').hidden = false
    refresh()
  })

  refresh()
  setInterval(refresh, 2000)
</script>
</html>
`
}
