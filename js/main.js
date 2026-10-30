// main.js — wires the machine to the reconstructed shell: one transparent
// hotspot per real key, a canvas laid exactly over the glass, and the physical
// keyboard mapped onto the same key ids.

import { KEYS, SHELL_W, SHELL_H, PC_KEYS } from './keymap.js?v=bank-v4';
import { LCD, GLASS } from './lcd.js?v=bank-v4';
import { Machine } from './machine.js?v=bank-v4';
import { setupProgramStudio } from './studio.js?v=bank-v4';

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

const studioController = setupProgramStudio(machine, () => {
  blink = true;
  lastBlink = performance.now();
  dirty = true;
});

function tap(id) {
  const b = buttons.get(id);
  if (b) {
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 90);
  }
  studioController.beforeKey();
  machine.press(id);
  studioController.syncFromMachine();
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

// ---- Program Studio from the faceplate ----------------------------------------
// On a phone the page is the calculator alone. Holding the faceplate above the
// display (brand and solar panel) for 0.6 s opens Program Studio.
const studioPanel = document.getElementById('studio');
const studioToggle = document.getElementById('studio-toggle');
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
    if (studioPanel.hidden) studioToggle.click();
  }, 600);
});
window.addEventListener('pointerup', cancelHold);
window.addEventListener('pointercancel', cancelHold);
shell.addEventListener('pointermove', (e) => {
  if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 12) cancelHold();
});

// Say once, on a phone, where Program Studio went.
try {
  if (phone.matches && !localStorage.getItem('fx50fhii.hint.studio')) {
    localStorage.setItem('fx50fhii.hint.studio', '1');
    setTimeout(() => showHint('Hold the solar panel to open Program Studio.', false), 800);
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
