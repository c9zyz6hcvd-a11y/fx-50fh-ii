// main.js — wires the machine to the reconstructed shell: one transparent
// hotspot per real key, a canvas laid exactly over the glass, and the physical
// keyboard mapped onto the same key ids.

import { KEYS, SHELL_W, SHELL_H, PC_KEYS } from './keymap.js?v=bank-v14';
import { LCD, GLASS } from './lcd.js?v=bank-v14';
import { Machine } from './machine.js?v=bank-v14';
import { parseProgramText } from './program-codec.js?v=bank-v14';
import { PROGRAMS, PROGRAM_BY_ID } from './program-catalog.generated.js?v=bank-v14';

const shell = document.getElementById('shell');
const canvas = document.getElementById('lcd');
const accessibleDisplay = document.getElementById('lcd-accessible');
const modeChip = document.getElementById('mode-chip');
const hintEl = document.getElementById('key-hint');
const machine = new Machine();
const lcd = new LCD(canvas);

// A key the current mode refuses explains itself instead of doing nothing.
let hintTimer = null;
function showHint(text, pointAtMode = true) {
  hintEl.textContent = text;
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), 5600);
  const modeKey = pointAtMode && buttons.get('MODE');
  if (modeKey) {
    modeKey.classList.add('attention');
    setTimeout(() => modeKey.classList.remove('attention'), 1500);
  }
}

const pct = (v, total) => (v / total) * 100 + '%';

// ---- glass -----------------------------------------------------------------
Object.assign(canvas.style, {
  left: pct(GLASS.x, SHELL_W), top: pct(GLASS.y, SHELL_H),
  width: pct(GLASS.w, SHELL_W), height: pct(GLASS.h, SHELL_H)
});

// ---- hotspots --------------------------------------------------------------
const buttons = new Map();
for (const k of KEYS) {
  const b = document.createElement('button');
  b.className = 'key' + (k.pad ? ' pad' : '') + (k.orange ? ' orange' : '');
  b.type = 'button';
  b.dataset.id = k.id;
  const functions = [
    k.shift && `SHIFT: ${k.shift}`,
    k.alpha && `ALPHA: ${k.alpha}`,
    k.basen && `BASE: ${k.basen}`,
    k.cmplx && `CMPLX: ${k.cmplx}`,
    k.stat && `statistics: ${k.stat}`,
    k.statShift && `statistics SHIFT: ${k.statShift}`,
    k.hex && `hexadecimal digit ${k.hex}`
  ].filter(Boolean);
  const keyLabel = `${k.base} key${functions.length ? `. ${functions.join('. ')}` : ''}`;
  b.setAttribute('aria-label', keyLabel);
  b.title = keyLabel;
  Object.assign(b.style, {
    left: pct(k.x, SHELL_W), top: pct(k.y, SHELL_H),
    width: pct(k.w, SHELL_W), height: pct(k.h, SHELL_H)
  });
  shell.appendChild(b);
  buttons.set(k.id, b);
}

let blink = true;
let dirty = true;
let lastNotice = 0;
let lastModeLabel = '';

modeChip.addEventListener('click', () => tap('MODE'));

// ---- the twelve built-in programs ---------------------------------------------
// They are rebuilt from the catalog on every start, so nothing can lose them.
// PRGM mode holds them in banks that fit 680 bytes (P1-P4, P5-P6, P7-P9,
// P10-P12); Prog lists them in the student's own order, four to a group.
const programTokens = new Map(PROGRAMS.map((p) => [p.id, parseProgramText(p.source, p.mode).tokenIds]));
{
  const groups = [];
  for (const program of PROGRAMS) {
    const group = groups[groups.length - 1];
    const bytes = group ? group.reduce((sum, p) => sum + p.bytes, 0) : 0;
    if (!group || group.length === 4 || bytes + program.bytes > 680) groups.push([program]);
    else group.push(program);
  }
  machine.banks = groups.map(() => [null, null, null, null]);
  groups.forEach((group, bank) => {
    machine.bank = bank;
    group.forEach((p, slot) => machine.setStudioProgram(slot, p.mode, programTokens.get(p.id)));
  });
  machine.bank = 0;
}

const ORDER_KEY = 'fx50fhii.program-order';
let order = PROGRAMS.map((p) => p.id);
try {
  const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
  if (Array.isArray(saved)) {
    const mine = saved.filter((id, i) => PROGRAM_BY_ID.has(id) && saved.indexOf(id) === i);
    order = [...mine, ...order.filter((id) => !mine.includes(id))];
  }
} catch {
  // No saved order: catalog order.
}
function applyOrder() {
  machine.library = order.map((id) => ({ mode: PROGRAM_BY_ID.get(id).mode, tokens: programTokens.get(id) }));
}
applyOrder();

function tap(id) {
  const b = buttons.get(id);
  if (b) {
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 90);
  }
  machine.press(id);
  blink = true;
  lastBlink = performance.now();
  dirty = true;
}

// Pointer down gives the key its tactile feel. The click listener is the
// fallback that makes the keys reachable by Tab and Enter, and by anything
// that synthesises a click without a pointer event; it stands down whenever a
// pointer gesture has just handled the same press.
let lastPointer = 0;

shell.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.key');
  if (!b) return;
  e.preventDefault();
  lastPointer = performance.now();
  tap(b.dataset.id);
});

shell.addEventListener('click', (e) => {
  const b = e.target.closest('.key');
  if (!b || performance.now() - lastPointer < 700) return;
  tap(b.dataset.id);
});

// ---- physical keyboard ------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target.closest('textarea, input, select, [contenteditable="true"]')) return;
  if (e.metaKey || e.ctrlKey) return;
  let m = PC_KEYS[e.key];
  if (m === undefined && e.key.length === 1) m = PC_KEYS[e.key.toLowerCase()];
  if (m === undefined) return;
  e.preventDefault();
  if (m.startsWith('!')) { tap('SHIFT'); tap(m.slice(1)); }
  else tap(m);
});

// ---- render loop ------------------------------------------------------------
let lastBlink = performance.now();
let lastAnnouncement = '';

function describeView(v) {
  const parts = [];
  const indicators = [...(v.indicators || [])];
  if (indicators.length) parts.push(`Indicators: ${indicators.join(', ')}`);
  if (v.line1 && v.line1.trim()) parts.push(`Upper display: ${v.line1.trim()}`);
  const lower = [v.left, v.line2].filter(Boolean).join(' ');
  if (lower) parts.push(`Lower display: ${lower}${v.exp ? ` times ten to ${v.exp}` : ''}`);
  return parts.join('. ') || 'Display blank';
}

function frame(now) {
  if (now - lastBlink > 480) { blink = !blink; lastBlink = now; dirty = true; }
  if (machine.prank !== lastPrank) {
    lastPrank = machine.prank;
    showPrank();
  }
  if (machine.notice && machine.notice.id !== lastNotice) {
    lastNotice = machine.notice.id;
    showHint(machine.notice.text);
  }
  const modeLabel = `${machine.mode} · ${machine.setup.angle}`;
  if (modeLabel !== lastModeLabel) {
    lastModeLabel = modeLabel;
    modeChip.textContent = modeLabel;
  }
  if (dirty) {
    const v = machine.view();
    v.blinkOn = blink;
    lcd.render(v);
    const announcement = describeView(v);
    if (announcement !== lastAnnouncement) {
      accessibleDisplay.textContent = announcement;
      lastAnnouncement = announcement;
    }
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- help panel -------------------------------------------------------------
const help = document.getElementById('help');
const helpToggle = document.getElementById('help-toggle');
let helpAnimation = null;
helpToggle.addEventListener('click', async () => {
  const opening = help.hidden;
  helpToggle.setAttribute('aria-expanded', String(opening));
  helpAnimation?.cancel();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || typeof help.animate !== 'function') {
    help.hidden = !opening;
    return;
  }
  if (opening) help.hidden = false;
  const height = help.scrollHeight;
  help.style.overflow = 'hidden';
  helpAnimation = help.animate(
    opening
      ? [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }]
      : [{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
    { duration: opening ? 220 : 160, easing: opening ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.4,0,1,1)' }
  );
  try { await helpAnimation.finished; } catch { return; }
  if (!opening) help.hidden = true;
  help.style.removeProperty('overflow');
  helpAnimation = null;
});

window.fx = machine;   // handy for poking at state from the console

// ---- Programs list ------------------------------------------------------------
// On a phone the page is the calculator alone: holding the faceplate above the
// display (brand and solar panel) for 0.6 s opens the list. A tap runs a
// program; dragging its handle ranks it, and the rank sets where Prog finds
// it (G1 P1 is the top program).
const programsPanel = document.getElementById('programs');
const programList = document.getElementById('program-list');
const redraw = () => { blink = true; lastBlink = performance.now(); dirty = true; };

function renderPrograms() {
  programList.replaceChildren(...order.map((id, rank) => {
    const program = PROGRAM_BY_ID.get(id);
    const item = document.createElement('li');
    const handle = document.createElement('span');
    handle.className = 'program-handle';
    handle.textContent = '≡';
    handle.setAttribute('aria-label', `Drag to rank ${program.title}`);
    const button = document.createElement('button');
    button.type = 'button';
    for (const [cls, text] of [
      ['program-key', `G${Math.floor(rank / 4) + 1} P${rank % 4 + 1}`],
      ['program-name', program.title],
      ['program-mode', program.mode]
    ]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      button.append(span);
    }
    button.addEventListener('click', () => {
      programsPanel.hidden = true;
      machine.runLibraryProgram(rank);
      redraw();
    });
    handle.addEventListener('pointerdown', (e) => startDrag(e, item, handle));
    item.append(handle, button);
    return item;
  }));
}

function startDrag(e, item, handle) {
  e.preventDefault();
  try { handle.setPointerCapture(e.pointerId); } catch { /* still works without capture */ }
  const rows = [...programList.children];
  const from = rows.indexOf(item);
  const mids = rows.map((row) => { const r = row.getBoundingClientRect(); return r.top + r.height / 2; });
  const height = item.getBoundingClientRect().height;
  const startY = e.clientY;
  let to = from;
  item.classList.add('dragging');
  const move = (ev) => {
    const dy = ev.clientY - startY;
    const centre = mids[from] + dy;
    to = rows.reduce((n, row, i) => (i !== from && mids[i] < centre ? n + 1 : n), 0);
    item.style.transform = `translateY(${dy}px)`;
    rows.forEach((row, i) => {
      if (row === item) return;
      const shift = from < to && i > from && i <= to ? -height : from > to && i >= to && i < from ? height : 0;
      row.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  // A drag the phone cancels (an edge swipe, a call) is undone, not saved.
  const end = (ev) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    if (ev.type === 'pointerup' && to !== from) {
      const [id] = order.splice(from, 1);
      order.splice(to, 0, id);
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* kept for this visit only */ }
      applyOrder();
    }
    renderPrograms();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

renderPrograms();
document.getElementById('programs-open').addEventListener('click', () => { programsPanel.hidden = false; });
document.getElementById('programs-close').addEventListener('click', () => { programsPanel.hidden = true; });
programsPanel.addEventListener('click', (e) => { if (e.target === programsPanel) programsPanel.hidden = true; });

// ---- SHIFT 9 3 --------------------------------------------------------------
// CLR All resets nothing in this edition; whoever tries it gets a face instead.
const prank = document.getElementById('prank');
let lastPrank = machine.prank;
let prankTimer = 0;
function showPrank() {
  prank.hidden = false;
  prank.classList.remove('pop');
  void prank.offsetWidth;   // restart the animation
  prank.classList.add('pop');
  clearTimeout(prankTimer);
  prankTimer = setTimeout(() => { prank.hidden = true; }, 3600);
}
prank.addEventListener('click', () => { prank.hidden = true; });

const phone = matchMedia('(max-width: 520px)');
let holdTimer = 0;
let holdStart = null;
const cancelHold = () => { clearTimeout(holdTimer); holdStart = null; };
shell.addEventListener('pointerdown', (e) => {
  if (!phone.matches || e.target.closest('.key')) return;
  const box = shell.getBoundingClientRect();
  if (e.clientY - box.top > box.height * GLASS.y / SHELL_H) return;
  cancelHold();
  holdStart = { x: e.clientX, y: e.clientY };
  holdTimer = setTimeout(() => {
    holdStart = null;
    programsPanel.hidden = false;
  }, 600);
});
window.addEventListener('pointerup', cancelHold);
window.addEventListener('pointercancel', cancelHold);
shell.addEventListener('pointermove', (e) => {
  if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 12) cancelHold();
});

// Say once, on a phone, where the programs are.
try {
  if (phone.matches && !localStorage.getItem('fx50fhii.hint.programs')) {
    localStorage.setItem('fx50fhii.hint.programs', '1');
    setTimeout(() => showHint('Hold the solar panel to choose a program.', false), 800);
  }
} catch {
  // Blocked storage only means the hint may show again.
}

// ---- offline app ------------------------------------------------------------
// Once opened over HTTPS (or added to the iPhone home screen) the calculator
// keeps working with no network; saved programs are asked to be kept.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
