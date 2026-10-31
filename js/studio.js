// Program Studio: persistent editing, a curated HKDSE library and protected
// backup/install workflows over the calculator's authentic Program objects.
// Nothing here is a second interpreter.

import { Program, PROGRAM_MEMORY, MAX_BANKS } from './program.js';
import { bytesOf } from './tokens.js';
import { formatProgramText, parseProgramText } from './program-codec.js';
import { PROGRAMS, PROGRAM_PACKS, PROGRAM_BY_ID } from './program-catalog.generated.js?v=bank-v11';

const STORAGE_KEY = 'fx50fhii.program-studio.v4';
const LEGACY_STORAGE_KEYS = ['fx50fhii.program-studio.v3', 'fx50fhii.program-studio.v2'];
const STORAGE_VERSION = 4;
const BACKUP_FORMAT = 'fx-50fh-ii-program-backup';
const BACKUP_VERSION = 1;          // one bank: four slots
const BANKS_BACKUP_VERSION = 2;    // every bank
const BANK_NAME_LENGTH = 40;
const MODES = new Set(['COMP', 'CMPLX', 'BASE', 'SD', 'REG']);
const SLOT_COUNT = 4;

const COMMANDS = [
  ['Flow', [['If', 'If '], ['Then', 'Then '], ['Else', 'Else '], ['IfEnd', 'IfEnd']]],
  ['Loops', [['For', 'For '], ['To', ' To '], ['Step', ' Step '], ['Next', 'Next'], ['While', 'While '], ['WhileEnd', 'WhileEnd'], ['Break', 'Break']]],
  ['Jump', [['Goto', 'Goto '], ['Lbl', 'Lbl '], ['⇒', '⇒']]],
  ['I/O', [['?', '?'], ['→', '→'], ['◢', '◢'], [':', '\n']]],
  ['Setup', [['Deg', 'Deg'], ['Rad', 'Rad'], ['Gra', 'Gra'], ['Fix', 'Fix '], ['Sci', 'Sci '], ['Norm', 'Norm '], ['ClrMem', 'ClrMemory'], ['ClrStat', 'ClrStat']]],
  ['Math', [['sin(', 'sin('], ['cos(', 'cos('], ['tan(', 'tan('], ['√(', '√('], ['π', 'π'], ['Ans', 'Ans'], ['×', '×'], ['÷', '÷']]]
];

const CATEGORY_ACCENTS = {
  Algebra: '#b24f31', Sequences: '#5f6f9c', Coordinate: '#2f7663',
  Trigonometry: '#9a6830', Finance: '#7d5b86', Statistics: '#467b83',
  Geometry: '#966142', Probability: '#526e3c', Variation: '#7b6041'
};

const clone = value => JSON.parse(JSON.stringify(value));
const clampSlot = value => Math.max(0, Math.min(SLOT_COUNT - 1, Number(value) || 0));
const slotName = slot => `P${slot + 1}`;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = () => reducedMotion() ? 'auto' : 'smooth';

export function filterProgramCatalog(query = '', category = 'All') {
  const needle = query.trim().toLocaleLowerCase();
  return PROGRAMS.filter(program => {
    if (category !== 'All' && program.category !== category) return false;
    if (!needle) return true;
    return [program.id, program.title, program.category, program.summary, ...program.topics]
      .join(' ').toLocaleLowerCase().includes(needle);
  });
}

export function packBytes(pack) {
  return pack.programIds.reduce((sum, id) => sum + PROGRAM_BY_ID.get(id).bytes, 0);
}

export function createProgramBackup(drafts, machineSnapshot, exportedAt = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    machine: clone(machineSnapshot),
    drafts: clone(drafts)
  };
}

export function parseProgramBackup(value) {
  const backup = typeof value === 'string' ? JSON.parse(value) : value;
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new Error('This is not an fx-50FH II Program Studio backup.');
  }
  if (!backup.machine || backup.machine.version !== 1 || !Array.isArray(backup.machine.slots) || backup.machine.slots.length !== SLOT_COUNT) {
    throw new Error('The backup has an invalid calculator snapshot.');
  }
  if (!Array.isArray(backup.drafts) || backup.drafts.length !== SLOT_COUNT) {
    throw new Error('The backup must contain exactly four slots.');
  }
  const drafts = backup.drafts.map((draft, index) => {
    if (!draft || !MODES.has(draft.mode) || typeof draft.source !== 'string' || draft.source.length > 20000) {
      throw new Error(`The ${slotName(index)} draft is invalid.`);
    }
    return { mode: draft.mode, source: draft.source };
  });
  return { machine: clone(backup.machine), drafts };
}

const bankName = value => typeof value === 'string' ? value.slice(0, BANK_NAME_LENGTH) : '';

export function createBanksBackup(banks, exportedAt = new Date().toISOString()) {
  return { format: BACKUP_FORMAT, version: BANKS_BACKUP_VERSION, exportedAt, banks: clone(banks) };
}

/** Reads either backup version. `whole` says it replaces every bank. */
export function parseAnyBackup(value) {
  const backup = typeof value === 'string' ? JSON.parse(value) : value;
  if (backup?.format === BACKUP_FORMAT && backup.version === BANKS_BACKUP_VERSION) {
    if (!Array.isArray(backup.banks) || !backup.banks.length || backup.banks.length > MAX_BANKS) {
      throw new Error('The backup has no valid program banks.');
    }
    return {
      whole: true,
      banks: backup.banks.map(bank => ({
        ...parseProgramBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION, machine: bank?.machine, drafts: bank?.drafts }),
        name: bankName(bank?.name)
      }))
    };
  }
  return { whole: false, banks: [{ ...parseProgramBackup(backup), name: '' }] };
}

export function setupProgramStudio(machine, onMachineChange) {
  const studio = document.getElementById('studio');
  const toggle = document.getElementById('studio-toggle');
  const viewTabs = [...document.querySelectorAll('#studio-view-tabs [role="tab"]')];
  const editorView = document.getElementById('studio-editor-view');
  const libraryView = document.getElementById('program-library-view');
  const slotsEl = document.getElementById('program-slots');
  const slotButtons = [...slotsEl.querySelectorAll('[data-slot]')];
  const editorPanel = document.getElementById('program-editor-panel');
  const source = document.getElementById('program-source');
  const mode = document.getElementById('studio-mode');
  const feedback = document.getElementById('program-feedback');
  const byteText = document.getElementById('program-bytes');
  const byteFill = document.getElementById('byte-fill');
  const saveState = document.getElementById('studio-save-state');
  const editorLabel = studio.querySelector('.editor-label');
  const clearButton = studio.querySelector('[data-studio-action="clear"]');
  const undoButton = document.getElementById('studio-undo');
  const backupFile = document.getElementById('studio-backup-file');
  const importButton = studio.querySelector('[data-studio-action="import-backup"]');
  const palette = document.getElementById('command-palette');
  const librarySearch = document.getElementById('library-search');
  const librarySlot = document.getElementById('library-slot');
  const libraryFilters = document.getElementById('library-filters');
  const libraryStatus = document.getElementById('library-status');
  const libraryCount = document.getElementById('library-result-count');
  const libraryGrid = document.getElementById('program-library-grid');
  const libraryEmpty = document.getElementById('library-empty');
  const packsEl = document.getElementById('program-packs');
  const libraryMemoryLabel = document.getElementById('library-memory-label');
  const libraryMemoryFill = document.getElementById('library-memory-fill');
  const bankNumber = document.getElementById('bank-number');
  const bankNameInput = document.getElementById('bank-name');
  const bankPrev = studio.querySelector('[data-studio-action="bank-prev"]');
  const bankNext = studio.querySelector('[data-studio-action="bank-next"]');
  const bankDelete = studio.querySelector('[data-studio-action="bank-delete"]');

  let selected = 0;
  // One draft list and one name per machine bank; `drafts` is the current one.
  let bankDrafts = [[null, null, null, null]];
  let bankNames = [''];
  let drafts = bankDrafts[0];
  let preloaded = false;         // the library is loaded once, on first open
  let deleteBankArmed = false;
  let deleteBankTimer = 0;
  let seen = [];                 // the current bank's slots as last synced from the calculator
  let inputTimer = 0;
  let inputPending = false;
  let lastValid = true;
  let clearArmed = false;
  let clearTimer = 0;
  let selectedCategory = 'All';
  let undoState = null;
  let pendingImport = null;
  let confirmationKey = '';
  let confirmationTimer = 0;
  let currentView = 'editor';

  function programFor(slot) { return machine.programs[slot]; }

  function deriveDraft(slot, bank = machine.bank) {
    const program = machine.banks[bank]?.[slot];
    const activeTokens = bank === machine.bank && machine.prog?.stage === 'edit' && machine.prog.slot === slot
      ? machine.prog.tokens
      : null;
    return {
      mode: program?.mode || 'COMP',
      source: activeTokens
        ? formatProgramText(activeTokens)
        : (program ? formatProgramText(program.tokens) : '')
    };
  }

  // The calculator's ◀ ▶ can open or drop the trailing bank on any key press.
  function syncBanks() {
    while (bankDrafts.length < machine.banks.length) {
      const bank = bankDrafts.length;
      bankDrafts.push([0, 1, 2, 3].map(slot => deriveDraft(slot, bank)));
      bankNames.push('');
    }
    bankDrafts.length = machine.banks.length;
    bankNames.length = machine.banks.length;
    bankDrafts.forEach((list, bank) => {
      for (let slot = 0; slot < SLOT_COUNT; slot++) if (!list[slot]) list[slot] = deriveDraft(slot, bank);
    });
    drafts = bankDrafts[machine.bank];
  }

  function setDrafts(list) {
    drafts = bankDrafts[machine.bank] = list;
  }

  const bankHasText = bank => Boolean(bankDrafts[bank]?.some(draft => draft?.source.trim()));
  // A bank that holds only draft text is never dropped by the calculator.
  machine.keepBank = bankHasText;

  function markSeen() {
    seen = machine.programSnapshot().slots.map(slot => JSON.stringify(slot));
  }

  function snapshotBanks() {
    syncBanks();
    return machine.banks.map((_, bank) => ({
      name: bankNames[bank] || '',
      machine: machine.programSnapshot(bank),
      drafts: clone(bankDrafts[bank])
    }));
  }

  /** Replace every bank at once; nothing changes if any bank is rejected. */
  function restoreBanks(list, bank = 0) {
    if (!Array.isArray(list) || !list.length) return false;
    const before = { banks: machine.banks, bank: machine.bank };
    machine.closePrograms();
    machine.banks = list.map(() => [null, null, null, null]);
    for (let i = 0; i < list.length; i++) {
      machine.bank = i;
      if (!machine.restoreProgramSnapshot(list[i]?.machine)) {
        machine.banks = before.banks;
        machine.bank = before.bank;
        return false;
      }
    }
    machine.bank = Math.max(0, Math.min(list.length - 1, Number(bank) || 0));
    bankDrafts = list.map((entry, i) => [0, 1, 2, 3].map(slot => {
      const draft = entry.drafts?.[slot];
      return draft && MODES.has(draft.mode) && typeof draft.source === 'string'
        ? { mode: draft.mode, source: draft.source }
        : deriveDraft(slot, i);
    }));
    bankNames = list.map(entry => bankName(entry.name));
    drafts = bankDrafts[machine.bank];
    return true;
  }

  function captureState() {
    return { bank: machine.bank, selected, banks: snapshotBanks() };
  }

  function restoreState(state) {
    if (!state || !restoreBanks(state.banks, state.bank)) return false;
    selected = clampSlot(state.selected);
    showSlot(selected);
    onMachineChange();
    return true;
  }

  // Drafts are the source of truth on load: a valid draft is stored into its
  // bank again, so text edited just before the page closed is never lost.
  function loadBank(saved) {
    machine.restoreProgramSnapshot(saved.machine);
    if (Array.isArray(saved.drafts)) {
      for (let index = 0; index < SLOT_COUNT; index++) {
        const draft = saved.drafts[index];
        drafts[index] = draft && MODES.has(draft.mode)
          ? { mode: draft.mode, source: String(draft.source || '') }
          : deriveDraft(index);
      }
    }
    const parsedDrafts = drafts.map(draft => draft ? parseProgramText(draft.source, draft.mode) : null);
    const draftBytes = parsedDrafts.reduce((sum, parsed) => sum + (parsed?.bytes || 0), 0);
    if (draftBytes <= PROGRAM_MEMORY) {
      parsedDrafts.forEach((parsed, index) => {
        const existed = Boolean(saved.machine?.slots?.[index]);
        if (parsed && !parsed.errors.length && (drafts[index].source.trim() || existed)) {
          machine.setStudioProgram(index, drafts[index].mode, parsed.tokenIds);
        }
      });
    }
  }

  function loadStorage() {
    try {
      const raw = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].map(key => localStorage.getItem(key)).find(Boolean);
      const saved = JSON.parse(raw || 'null');
      if (!saved) return;
      let banks;
      if (saved.version === STORAGE_VERSION && Array.isArray(saved.banks) && saved.banks.length) {
        banks = saved.banks.slice(0, MAX_BANKS);
      } else if ([2, 3].includes(saved.version)) {
        banks = [{ machine: saved.machine, drafts: saved.drafts, name: '' }];
      } else {
        return;
      }
      machine.banks = banks.map(() => [null, null, null, null]);
      bankDrafts = banks.map(() => [null, null, null, null]);
      bankNames = banks.map(bank => bankName(bank?.name));
      banks.forEach((bank, index) => {
        machine.bank = index;
        drafts = bankDrafts[index];
        loadBank(bank || {});
      });
      machine.bank = Math.max(0, Math.min(banks.length - 1, Number(saved.bank) || 0));
      drafts = bankDrafts[machine.bank];
      selected = clampSlot(saved.selected);
      if (saved.version === STORAGE_VERSION && Array.isArray(saved.undoState?.banks)) undoState = saved.undoState;
      preloaded = saved.version === STORAGE_VERSION && Boolean(saved.preloaded);
    } catch {
      // Corrupt or blocked storage never prevents the calculator from loading.
    }
  }

  function persist() {
    try {
      const banks = snapshotBanks();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        bank: machine.bank,
        selected,
        banks,
        undoState,
        preloaded,
        updatedAt: Date.now()
      }));
      saveState.textContent = 'saved';
    } catch {
      saveState.textContent = 'not saved';
    }
    undoButton.hidden = !undoState;
  }

  function totalBytesWith(slot, slotBytes) {
    return machine.programs.reduce((sum, program, index) =>
      sum + (index === slot ? slotBytes : (program ? bytesOf(program.tokens) : 0)), 0);
  }

  function inspectEditor(commit = false) {
    const parsed = parseProgramText(source.value, mode.value);
    const total = totalBytesWith(selected, parsed.bytes);
    let message = '';
    let storable = true;
    let runnable = true;

    if (parsed.errors.length) {
      const first = parsed.errors[0];
      message = `Unknown “${first.character}” at character ${first.index + 1}.`;
      storable = false;
      runnable = false;
    } else if (total > PROGRAM_MEMORY) {
      message = `${total - PROGRAM_MEMORY} bytes over shared memory.`;
      storable = false;
      runnable = false;
    } else {
      try {
        new Program(mode.value, parsed.tokens).start(machine);
        message = parsed.tokens.length
          ? `Structure OK · ${parsed.tokens.length} token${parsed.tokens.length === 1 ? '' : 's'}`
          : 'Empty program — ready.';
      } catch (error) {
        message = `Draft saved · ${error.message || 'program structure is incomplete.'}`;
        runnable = false;
      }
    }

    source.classList.toggle('invalid', !runnable);
    feedback.classList.toggle('error', !runnable);
    feedback.textContent = message;
    byteText.textContent = `${total} / ${PROGRAM_MEMORY} bytes`;
    const ratio = Math.min(1, total / PROGRAM_MEMORY);
    byteFill.style.width = `${ratio * 100}%`;
    byteFill.classList.toggle('warning', ratio > .82);
    lastValid = storable;

    drafts[selected] = { mode: mode.value, source: source.value };
    if (commit && storable) {
      machine.setStudioProgram(selected, mode.value, parsed.tokenIds);
      markSeen();
      onMachineChange();
    }
    persist();
    renderSlots();
    renderLibraryMemory();
    return { storable, runnable, parsed };
  }

  function renderSlots() {
    slotButtons.forEach((button, index) => {
      const program = programFor(index);
      const draft = drafts[index] || deriveDraft(index);
      const parsed = parseProgramText(draft.source, draft.mode);
      const active = index === selected;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      button.querySelector('span').textContent = draft.source
        ? `${draft.mode} · ${parsed.bytes}B`
        : (program ? `${program.mode} · ${program.bytes}B` : 'empty');
    });
    editorPanel.setAttribute('aria-labelledby', `slot-tab-${selected + 1}`);
    librarySlot.value = String(selected);
    renderBanks();
  }

  function renderBanks() {
    const many = machine.banks.length > 1;
    bankNumber.textContent = `Bank ${machine.bank + 1} of ${machine.banks.length}`;
    if (document.activeElement !== bankNameInput) bankNameInput.value = bankNames[machine.bank] || '';
    bankPrev.disabled = !many;
    bankNext.disabled = !many;
    bankDelete.hidden = !many;
    if (!deleteBankArmed) bankDelete.textContent = 'Delete bank';
  }

  /** Move Studio and the calculator to bank i (banks.length = a new bank). */
  function showBank(index) {
    clearTimeout(inputTimer);
    inputPending = false;
    inspectEditor(true);
    deleteBankArmed = false;
    clearTimeout(deleteBankTimer);
    machine.closePrograms();
    machine.switchBank(index);
    syncBanks();
    showSlot(selected);
    onMachineChange();
    persist();
    if (currentView === 'library') renderLibrary();
  }

  /** Index of an empty bank to fill: the trailing one if it is unused, else a new one; -1 when full. */
  function freshBankIndex() {
    const last = machine.banks.length - 1;
    if (!machine.bankUsed(last) && !bankHasText(last)) return last;
    return machine.banks.length < MAX_BANKS ? machine.banks.length : -1;
  }

  const banksFullMessage = `All ${MAX_BANKS} banks are in use. Delete a bank first.`;

  function showSlot(slot) {
    clearArmed = false;
    clearTimeout(clearTimer);
    selected = clampSlot(slot);
    const draft = drafts[selected] || deriveDraft(selected);
    drafts[selected] = draft;
    mode.value = draft.mode;
    source.value = draft.source;
    editorLabel.textContent = `${slotName(selected)} source`;
    clearButton.textContent = `Clear ${slotName(selected)}`;
    inspectEditor(false);
    renderSlots();
    markSeen();
  }

  function insertAtCursor(text) {
    source.setRangeText(text, source.selectionStart, source.selectionEnd, 'end');
    source.focus();
    source.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function buildPalette() {
    for (const [name, commands] of COMMANDS) {
      const group = document.createElement('div');
      group.className = 'command-group';
      const label = document.createElement('span');
      label.textContent = name;
      const buttons = document.createElement('div');
      buttons.className = 'command-buttons';
      for (const [caption, value] of commands) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = caption;
        button.addEventListener('click', () => insertAtCursor(value));
        buttons.appendChild(button);
      }
      group.append(label, buttons);
      palette.appendChild(group);
    }
  }

  function setView(view, focusTab = false) {
    currentView = view;
    const library = view === 'library';
    editorView.hidden = library;
    libraryView.hidden = !library;
    viewTabs.forEach((tab, index) => {
      const active = library ? index === 1 : index === 0;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    if (library) renderLibrary();
  }

  function moveTab(buttons, current, key, activate) {
    const index = buttons.indexOf(current);
    if (index < 0) return false;
    let next = index;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = buttons.length - 1;
    else return false;
    activate(next);
    buttons[next].focus();
    return true;
  }

  function renderLibraryMemory() {
    const used = machine.programs.reduce((sum, program) => sum + (program ? program.bytes : 0), 0);
    const ratio = used / PROGRAM_MEMORY;
    libraryMemoryLabel.textContent = `Bank ${machine.bank + 1} · ${used} / ${PROGRAM_MEMORY}B used`;
    libraryMemoryFill.style.width = `${Math.min(1, ratio) * 100}%`;
    libraryMemoryFill.classList.toggle('warning', ratio > .82);
  }

  function clearConfirmation() {
    confirmationKey = '';
    clearTimeout(confirmationTimer);
  }

  function requireReplacementConfirmation(key, button, label) {
    if (confirmationKey === key) {
      clearConfirmation();
      return true;
    }
    confirmationKey = key;
    button.classList.add('confirming');
    button.textContent = label;
    libraryStatus.textContent = 'Existing program data will be replaced. Confirm once more.';
    clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(() => { clearConfirmation(); renderLibrary(); }, 5000);
    return false;
  }

  function rememberUndo() {
    undoState = captureState();
    persist();
  }

  function installProgram(program, slot, button) {
    const occupied = Boolean(drafts[slot]?.source.trim());
    if (occupied && !requireReplacementConfirmation(`program:${program.id}:${slot}`, button, `Replace ${slotName(slot)}?`)) return;
    const parsed = parseProgramText(program.source, program.mode);
    const total = totalBytesWith(slot, parsed.bytes);
    if (parsed.errors.length || total > PROGRAM_MEMORY) {
      libraryStatus.textContent = total > PROGRAM_MEMORY
        ? `This install needs ${total - PROGRAM_MEMORY} more bytes. Clear another slot first.`
        : 'The catalog source did not parse. No slot was changed.';
      return;
    }
    rememberUndo();
    machine.setStudioProgram(slot, program.mode, parsed.tokenIds);
    drafts[slot] = { mode: program.mode, source: program.source };
    selected = slot;
    showSlot(slot);
    persist();
    onMachineChange();
    libraryStatus.textContent = `${program.title} installed in ${slotName(slot)}. Undo is available in Editor.`;
    saveState.textContent = 'installed';
    renderLibrary();
  }

  /** Bank number (1-based) that already holds this whole pack, or 0. */
  function packBank(pack) {
    const index = bankDrafts.findIndex(list => pack.programIds.every((id, slot) =>
      list[slot]?.source.trim() === PROGRAM_BY_ID.get(id).source.trim()));
    return index + 1;
  }

  // Writes a pack into the current bank. The caller has already taken undo.
  function writePack(pack) {
    const entries = pack.programIds.map(id => {
      const program = PROGRAM_BY_ID.get(id);
      const parsed = parseProgramText(program.source, program.mode);
      return { program, parsed };
    });
    const snapshot = {
      version: 1,
      slots: entries.map(({ program, parsed }) => ({ mode: program.mode, tokens: parsed.tokenIds }))
    };
    if (!machine.restoreProgramSnapshot(snapshot)) return false;
    setDrafts(entries.map(({ program }) => ({ mode: program.mode, source: program.source })));
    if (!bankNames[machine.bank]) bankNames[machine.bank] = bankName(pack.name);
    return true;
  }

  function installPack(pack, button, newBank = false) {
    if (newBank && freshBankIndex() < 0) {
      libraryStatus.textContent = banksFullMessage;
      return;
    }
    const occupied = !newBank && drafts.some(draft => draft?.source.trim());
    if (occupied && !requireReplacementConfirmation(`pack:${pack.id}`, button, 'Replace all four?')) return;
    rememberUndo();
    if (newBank) {
      machine.closePrograms();
      machine.switchBank(freshBankIndex());
      syncBanks();
    } else if (PROGRAM_PACKS.some(other => other.name === bankNames[machine.bank])) {
      bankNames[machine.bank] = '';   // a pack's own name, not one the student typed
    }
    if (!writePack(pack)) {
      restoreState(undoState);
      undoState = null;
      persist();
      libraryStatus.textContent = 'The pack could not be installed. Nothing was changed.';
      return;
    }
    selected = 0;
    showSlot(0);
    persist();
    onMachineChange();
    libraryStatus.textContent = `${pack.name} installed in bank ${machine.bank + 1}, P1–P4. Undo is available in Editor.`;
    saveState.textContent = 'pack installed';
    renderLibrary();
  }

  /** Every pack not yet in a bank goes into a bank of its own. */
  function installAllPacks() {
    const missing = PROGRAM_PACKS.filter(pack => !packBank(pack));
    if (!missing.length) {
      libraryStatus.textContent = 'Every pack is already in a bank.';
      return;
    }
    const last = machine.banks.length - 1;
    const room = MAX_BANKS - machine.banks.length + (!machine.bankUsed(last) && !bankHasText(last) ? 1 : 0);
    if (room < missing.length) {
      libraryStatus.textContent = `${missing.length} new banks are needed but only ${room} are free. Delete some banks first.`;
      return;
    }
    rememberUndo();
    machine.closePrograms();
    for (const pack of missing) {
      machine.switchBank(freshBankIndex());
      syncBanks();
      if (!writePack(pack)) {
        restoreState(undoState);
        undoState = null;
        persist();
        libraryStatus.textContent = 'A pack could not be installed. Nothing was changed.';
        return;
      }
    }
    machine.switchBank(0);
    syncBanks();
    selected = 0;
    showSlot(0);
    persist();
    onMachineChange();
    libraryStatus.textContent = `${missing.length} pack${missing.length === 1 ? '' : 's'} added as new banks. Prog then ◀ ▶ switches bank.`;
    saveState.textContent = 'packs installed';
    renderLibrary();
  }

  function renderFilters() {
    const categories = ['All', ...new Set(PROGRAMS.map(program => program.category))];
    libraryFilters.replaceChildren(...categories.map(category => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', String(category === selectedCategory));
      button.textContent = category;
      return button;
    }));
  }

  function renderPacks() {
    packsEl.replaceChildren(...PROGRAM_PACKS.map(pack => {
      const card = document.createElement('article');
      card.className = 'pack-card';
      const total = packBytes(pack);
      const installed = pack.programIds.every((id, slot) => drafts[slot]?.source.trim() === PROGRAM_BY_ID.get(id).source.trim());
      const inBank = packBank(pack);
      const title = document.createElement('h3');
      title.textContent = pack.name;
      const description = document.createElement('p');
      description.textContent = pack.description;
      const slots = document.createElement('div');
      slots.className = 'pack-slots';
      pack.programIds.forEach((id, slot) => {
        const tag = document.createElement('span');
        const slotLabel = document.createElement('b');
        slotLabel.textContent = slotName(slot);
        const programLabel = document.createElement('i');
        programLabel.textContent = id;
        tag.append(slotLabel, programLabel);
        slots.appendChild(tag);
      });
      const footer = document.createElement('footer');
      const bytes = document.createElement('span');
      bytes.textContent = `${total}B`;
      const install = document.createElement('button');
      install.type = 'button';
      install.dataset.libraryAction = 'install-pack';
      install.dataset.packId = pack.id;
      install.disabled = installed;
      install.textContent = installed ? 'In this bank' : 'Load here';
      const newBank = document.createElement('button');
      newBank.type = 'button';
      newBank.dataset.libraryAction = 'install-pack-new-bank';
      newBank.dataset.packId = pack.id;
      newBank.disabled = Boolean(inBank);
      newBank.textContent = inBank ? `In bank ${inBank}` : 'New bank';
      footer.append(bytes, install, newBank);
      card.append(title, description, slots, footer);
      return card;
    }));
  }

  function renderPrograms() {
    const programs = filterProgramCatalog(librarySearch.value, selectedCategory);
    libraryCount.textContent = `${programs.length} program${programs.length === 1 ? '' : 's'}`;
    libraryEmpty.hidden = programs.length !== 0;
    const slot = clampSlot(librarySlot.value);
    libraryGrid.replaceChildren(...programs.map(program => {
      const card = document.createElement('article');
      card.className = 'program-card';
      card.style.setProperty('--card-accent', CATEGORY_ACCENTS[program.category] || '#2f7663');

      const head = document.createElement('div');
      head.className = 'program-card-head';
      const identity = document.createElement('div');
      const id = document.createElement('span');
      id.className = 'program-id';
      id.textContent = `${program.id} · ${program.category}`;
      const title = document.createElement('h3');
      title.textContent = program.title;
      identity.append(id, title);
      const bytes = document.createElement('span');
      bytes.className = 'program-bytes';
      bytes.textContent = `${program.bytes}B`;
      head.append(identity, bytes);

      const summary = document.createElement('p');
      summary.className = 'program-summary';
      summary.textContent = program.summary;

      const details = document.createElement('details');
      const detailsSummary = document.createElement('summary');
      detailsSummary.textContent = 'Inputs, outputs & example';
      const reveal = document.createElement('div');
      reveal.className = 'program-details-content';
      const revealInner = document.createElement('div');
      const list = document.createElement('dl');
      for (const [term, value] of [['Inputs', program.inputs], ['Outputs', program.outputs], ['Example', program.example]]) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        list.append(dt, dd);
      }
      const code = document.createElement('pre');
      code.textContent = program.source;
      revealInner.append(list, code);
      reveal.appendChild(revealInner);
      details.append(detailsSummary, reveal);

      const install = document.createElement('button');
      install.type = 'button';
      install.dataset.libraryAction = 'install-program';
      install.dataset.programId = program.id;
      const installed = drafts[slot]?.source.trim() === program.source.trim();
      const projected = totalBytesWith(slot, program.bytes);
      install.disabled = installed || projected > PROGRAM_MEMORY;
      install.textContent = installed
        ? `Installed in ${slotName(slot)}`
        : projected > PROGRAM_MEMORY
          ? `Needs ${projected - PROGRAM_MEMORY}B free`
          : `Install to ${slotName(slot)} · ${program.bytes}B`;
      card.append(head, summary, details, install);
      return card;
    }));
  }

  function renderLibrary() {
    renderLibraryMemory();
    renderFilters();
    renderPacks();
    renderPrograms();
  }

  async function copyProgram() {
    try {
      await navigator.clipboard.writeText(source.value);
      saveState.textContent = 'copied';
    } catch {
      source.select();
      document.execCommand('copy');
      saveState.textContent = 'copied';
    }
  }

  async function pasteProgram() {
    try {
      const text = await navigator.clipboard.readText();
      source.setRangeText(text, source.selectionStart, source.selectionEnd, 'end');
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.focus();
    } catch {
      source.focus();
      feedback.textContent = 'Clipboard access was blocked — press ⌘V or Ctrl+V here.';
    }
  }

  function exportBackup() {
    const backup = createBanksBackup(snapshotBanks());
    const blob = new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fx-50fh-ii-programs-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    saveState.textContent = 'exported';
    feedback.textContent = `All ${backup.banks.length} bank${backup.banks.length === 1 ? '' : 's'} exported as a versioned backup.`;
  }

  // A whole backup replaces every bank; an older one-bank backup replaces only
  // the current bank.
  function applyImport() {
    if (!pendingImport) { backupFile.click(); return; }
    const { whole, banks } = pendingImport;
    rememberUndo();
    let ok;
    if (whole) {
      ok = restoreBanks(banks, 0);
    } else {
      machine.closePrograms();
      ok = machine.restoreProgramSnapshot(banks[0].machine);
      if (ok) setDrafts(clone(banks[0].drafts));
    }
    pendingImport = null;
    importButton.textContent = 'Import backup';
    if (!ok) {
      undoState = null;
      feedback.textContent = 'Backup rejected: invalid program data or more than 680 bytes in a bank.';
      persist();
      return;
    }
    selected = 0;
    showSlot(0);
    persist();
    onMachineChange();
    feedback.textContent = whole
      ? `Backup restored: ${banks.length} bank${banks.length === 1 ? '' : 's'}. Undo is available.`
      : `Backup restored into bank ${machine.bank + 1}. Undo is available.`;
    saveState.textContent = 'restored';
    renderLibrary();
  }

  function deleteCurrentBank() {
    if (!deleteBankArmed) {
      deleteBankArmed = true;
      bankDelete.textContent = `Confirm delete bank ${machine.bank + 1}`;
      feedback.textContent = 'Press confirm once more. Undo can bring the bank back.';
      clearTimeout(deleteBankTimer);
      deleteBankTimer = setTimeout(() => { deleteBankArmed = false; renderBanks(); }, 4000);
      return;
    }
    deleteBankArmed = false;
    clearTimeout(deleteBankTimer);
    rememberUndo();
    const index = machine.bank;
    machine.deleteBank(index);
    bankDrafts.splice(index, 1);
    bankNames.splice(index, 1);
    syncBanks();
    showSlot(selected);
    persist();
    onMachineChange();
    feedback.textContent = `Bank ${index + 1} deleted. Undo is available.`;
    if (currentView === 'library') renderLibrary();
  }

  // First open: the whole library, in catalog order, a bank at a time. A new
  // bank starts when four slots or 680 bytes are used, so the numbering stays
  // P1–P4 in bank 1 and onwards.
  // The library in catalog order, a new bank whenever four areas or 680
  // bytes are used: P1–P4, P5–P6, P7–P9, P10–P12.
  function libraryGroups() {
    const groups = [];
    for (const program of PROGRAMS) {
      const group = groups[groups.length - 1];
      const bytes = group ? group.reduce((sum, p) => sum + p.bytes, 0) : 0;
      if (!group || group.length === SLOT_COUNT || bytes + program.bytes > PROGRAM_MEMORY) groups.push([program]);
      else group.push(program);
    }
    return groups;
  }
  const groupName = group => group.length > 1 ? `${group[0].id}–${group[group.length - 1].id}` : group[0].id;

  function preloadLibrary() {
    const groups = libraryGroups();
    try {
      machine.banks = groups.map(() => [null, null, null, null]);
      bankDrafts = groups.map(() => [null, null, null, null]);
      bankNames = groups.map(groupName);
      groups.forEach((group, bank) => {
        machine.bank = bank;
        group.forEach((program, slot) => {
          machine.setStudioProgram(slot, program.mode, parseProgramText(program.source, program.mode).tokenIds);
          bankDrafts[bank][slot] = { mode: program.mode, source: program.source };
        });
      });
    } catch {
      machine.banks = [[null, null, null, null]];
      bankDrafts = [[null, null, null, null]];
      bankNames = [''];
      machine.bank = 0;
      drafts = bankDrafts[0];
      return false;
    }
    machine.bank = 0;
    drafts = bankDrafts[0];
    return true;
  }

  loadStorage();
  // A failed preload is tried again on the next open; it only ever runs
  // while every bank is empty, so nothing can be overwritten.
  if (!preloaded) {
    preloaded = machine.banks.every((_, bank) => machine.bankEmpty(bank)) ? preloadLibrary() : true;
  }
  syncBanks();
  buildPalette();
  showSlot(selected);
  renderLibrary();
  persist();

  toggle.addEventListener('click', async () => {
    const opening = studio.hidden;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) {
      studio.classList.remove('studio-leave');
      studio.hidden = false;
      navigator.storage?.persist?.().catch(() => {});
      studio.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      return;
    }
    if (reducedMotion()) {
      studio.hidden = true;
      return;
    }
    studio.classList.add('studio-leave');
    await new Promise(resolve => {
      const done = () => { studio.removeEventListener('animationend', done); resolve(); };
      studio.addEventListener('animationend', done, { once: true });
      setTimeout(done, 230);
    });
    studio.hidden = true;
    studio.classList.remove('studio-leave');
  });

  document.getElementById('studio-view-tabs').addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) setView(tab.id === 'library-tab' ? 'library' : 'editor');
  });
  document.getElementById('studio-view-tabs').addEventListener('keydown', event => {
    if (moveTab(viewTabs, event.target.closest('[role="tab"]'), event.key, index => setView(index ? 'library' : 'editor'))) event.preventDefault();
  });

  slotsEl.addEventListener('click', event => {
    const button = event.target.closest('[data-slot]');
    if (button) showSlot(Number(button.dataset.slot));
  });
  slotsEl.addEventListener('keydown', event => {
    if (moveTab(slotButtons, event.target.closest('[data-slot]'), event.key, index => showSlot(index))) event.preventDefault();
  });

  source.addEventListener('input', () => {
    saveState.textContent = 'saving';
    drafts[selected] = { mode: mode.value, source: source.value };
    persist(); // raw text is recoverable even before it becomes valid
    clearTimeout(inputTimer);
    inputPending = true;
    inputTimer = setTimeout(() => { inputPending = false; inspectEditor(true); }, 120);
  });

  mode.addEventListener('change', () => inspectEditor(true));
  librarySearch.addEventListener('input', renderPrograms);
  librarySlot.addEventListener('change', () => {
    showSlot(Number(librarySlot.value));
    renderPrograms();
  });
  libraryFilters.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    selectedCategory = button.dataset.category;
    renderFilters();
    renderPrograms();
  });
  libraryView.addEventListener('click', event => {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;
    if (button.dataset.libraryAction === 'install-program') {
      installProgram(PROGRAM_BY_ID.get(button.dataset.programId), clampSlot(librarySlot.value), button);
    } else if (button.dataset.libraryAction === 'install-pack') {
      installPack(PROGRAM_PACKS.find(pack => pack.id === button.dataset.packId), button);
    } else if (button.dataset.libraryAction === 'install-pack-new-bank') {
      installPack(PROGRAM_PACKS.find(pack => pack.id === button.dataset.packId), button, true);
    } else if (button.dataset.libraryAction === 'install-all-packs') {
      installAllPacks();
    }
  });

  bankNameInput.addEventListener('input', () => {
    bankNames[machine.bank] = bankName(bankNameInput.value);
    persist();
  });

  backupFile.addEventListener('change', async () => {
    const file = backupFile.files?.[0];
    backupFile.value = '';
    if (!file) return;
    try {
      pendingImport = parseAnyBackup(await file.text());
      importButton.textContent = 'Apply backup';
      feedback.textContent = pendingImport.whole
        ? `Backup checked: ${pendingImport.banks.length} bank${pendingImport.banks.length === 1 ? '' : 's'}. Click Apply backup to replace every bank.`
        : `Backup checked. Click Apply backup to replace bank ${machine.bank + 1}.`;
      saveState.textContent = 'ready to restore';
    } catch (error) {
      pendingImport = null;
      importButton.textContent = 'Import backup';
      feedback.textContent = error.message || 'The backup could not be read.';
      saveState.textContent = 'import rejected';
    }
  });

  studio.addEventListener('click', async event => {
    const action = event.target.closest('[data-studio-action]')?.dataset.studioAction;
    if (!action) return;
    if (action === 'copy') return copyProgram();
    if (action === 'paste') return pasteProgram();
    if (action === 'export-backup') return exportBackup();
    if (action === 'import-backup') return applyImport();
    if (action === 'bank-prev' || action === 'bank-next') {
      const count = machine.banks.length;
      return showBank((machine.bank + (action === 'bank-next' ? 1 : -1) + count) % count);
    }
    if (action === 'bank-new') {
      if (freshBankIndex() < 0) { feedback.textContent = banksFullMessage; return; }
      showBank(freshBankIndex());
      feedback.textContent = `Bank ${machine.bank + 1} is ready: four empty slots, 680 bytes.`;
      return;
    }
    if (action === 'bank-delete') return deleteCurrentBank();
    if (action === 'undo-install') {
      const previous = undoState;
      undoState = null;
      if (restoreState(previous)) {
        feedback.textContent = 'Previous program banks restored.';
        saveState.textContent = 'undone';
        renderLibrary();
      }
      persist();
      return;
    }

    const state = inspectEditor(true);
    if (action === 'run' && !state.runnable) return;
    if (action === 'edit-calculator' && !state.storable) return;
    if (action === 'run') {
      machine.prog = null;
      machine.mode = 'COMP';
      machine.error = null;
      machine.runProgram(selected);
      onMachineChange();
      document.getElementById('stage').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    } else if (action === 'edit-calculator') {
      machine.editProgramSlot(selected);
      onMachineChange();
      document.getElementById('stage').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    } else if (action === 'clear') {
      if (!clearArmed) {
        clearArmed = true;
        clearButton.textContent = `Confirm clear ${slotName(selected)}`;
        feedback.textContent = 'Click confirm clear once more — this cannot be undone.';
        clearTimer = setTimeout(() => showSlot(selected), 4000);
        return;
      }
      machine.clearStudioProgram(selected);
      drafts[selected] = { mode: 'COMP', source: '' };
      showSlot(selected);
      onMachineChange();
      renderLibrary();
    }
  });

  document.getElementById('studio-close').addEventListener('click', () => {
    if (!studio.hidden) toggle.click();
  });

  window.addEventListener('pagehide', persist);

  /**
   * Run a library program from the Programs list. It runs from wherever an
   * identical copy is stored; when there is none (cleared by CLR All, say) it
   * goes back to its first-open bank and area if that area is free, else into
   * a new bank, so nothing the student wrote is overwritten.
   */
  function runLibrary(id) {
    const program = PROGRAM_BY_ID.get(id);
    const parsed = program && parseProgramText(program.source, program.mode);
    if (!parsed || parsed.errors.length) return 'This program could not be read.';
    syncBanks();
    const wanted = JSON.stringify({ mode: program.mode, tokens: parsed.tokenIds });
    let place = null;
    for (let bank = 0; bank < machine.banks.length && !place; bank++) {
      const slot = machine.programSnapshot(bank).slots.findIndex(entry => JSON.stringify(entry) === wanted);
      if (slot >= 0) place = { bank, slot };
    }
    if (!place) {
      const groups = libraryGroups();
      const bank = groups.findIndex(group => group.includes(program));
      const slot = groups[bank].indexOf(program);
      const free = bank < machine.banks.length
        && !bankDrafts[bank]?.[slot]?.source.trim()
        && !machine.programSnapshot(bank).slots[slot]?.tokens.length;
      const atEnd = bank === machine.banks.length;
      const fresh = freshBankIndex();
      if (!free && !atEnd && fresh < 0) return banksFullMessage;
      rememberUndo();
      const tryPlace = (target, targetSlot) => {
        machine.closePrograms();
        machine.switchBank(target);
        syncBanks();
        try {
          machine.setStudioProgram(targetSlot, program.mode, parsed.tokenIds);
        } catch {
          return false;   // the other areas of that bank leave too little memory
        }
        drafts[targetSlot] = { mode: program.mode, source: program.source };
        if (!bankNames[target]) bankNames[target] = target === bank ? groupName(groups[bank]) : program.id;
        place = { bank: target, slot: targetSlot };
        return true;
      };
      if (!((free || atEnd) && tryPlace(bank, slot))) {
        const target = freshBankIndex();
        if (target < 0 || !tryPlace(target, 0)) { restoreState(undoState); return banksFullMessage; }
      }
      markSeen();
      persist();
    } else if (place.bank !== machine.bank) {
      machine.closePrograms();
      machine.switchBank(place.bank);
      syncBanks();
    }
    machine.runStored(place.slot);
    showSlot(place.slot);
    persist();
    onMachineChange();
    if (currentView === 'library') renderLibrary();
    return '';
  }

  return {
    persist,
    runLibrary,
    /** Store text typed a moment ago before a calculator key acts on it. */
    beforeKey() {
      if (!inputPending) return;
      clearTimeout(inputTimer);
      inputPending = false;
      inspectEditor(true);
    },
    syncFromMachine() {
      const bankBefore = drafts;
      syncBanks();
      if (drafts !== bankBefore) {
        // The calculator's ◀ ▶ moved to another bank.
        showSlot(selected);
        persist();
        if (currentView === 'library') renderLibrary();
        return;
      }
      // A slot the calculator changed since Studio last looked takes the
      // calculator's version, except the slot being typed into while it still
      // has an error; any other draft is newer (maybe not storable yet) and
      // stays as typed.
      const typing = document.activeElement === source && !lastValid;
      const now = machine.programSnapshot().slots.map(slot => JSON.stringify(slot));
      for (let i = 0; i < drafts.length; i++) {
        if (now[i] === seen[i] || (typing && i === selected)) continue;
        drafts[i] = deriveDraft(i);
        seen[i] = now[i];
      }
      if (typing) { renderSlots(); persist(); return; }
      showSlot(selected);
      persist();
      if (currentView === 'library') renderLibrary();
    }
  };
}
