// sidepanel.js — ClipZy
// All snippet CRUD, search, pin, export/import and sync-toggle logic lives here.

const els = {
  list: document.getElementById("list"),
  emptyState: document.getElementById("emptyState"),
  countLabel: document.getElementById("countLabel"),
  searchInput: document.getElementById("searchInput"),
  newSnippetText: document.getElementById("newSnippetText"),
  newSnippetTrigger: document.getElementById("newSnippetTrigger"),
  addBtn: document.getElementById("addBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  syncToggle: document.getElementById("syncToggle"),
  expansionToggle: document.getElementById("expansionToggle"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  toast: document.getElementById("toast")
};

const EXPANDER_SCRIPT_ID = "clipzy-expander";

let state = {
  snippets: [],
  settings: { syncEnabled: false },
  query: ""
};

init();

async function init() {
  state.settings = await getSettings();
  els.syncToggle.checked = state.settings.syncEnabled;

  // Reflect reality, not just the stored flag — the permission could have
  // been revoked from chrome://extensions/permissions independently.
  const hasPermission = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  els.expansionToggle.checked = !!(state.settings.expansionEnabled && hasPermission);
  if (state.settings.expansionEnabled && !hasPermission) {
    state.settings.expansionEnabled = false;
    await chrome.storage.local.set({ settings: state.settings });
  }

  await loadSnippets();
  render();
  bindEvents();

  // Keep the panel live if a snippet is added from another tab/window
  // (e.g. via the right-click context menu) while this panel is open.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const activeArea = state.settings.syncEnabled ? "sync" : "local";
    if (areaName === activeArea && changes.snippets) {
      state.snippets = changes.snippets.newValue || [];
      render();
    }
  });
}

function bindEvents() {
  els.addBtn.addEventListener("click", addManualSnippet);
  els.newSnippetText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addManualSnippet();
  });

  els.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  els.settingsBtn.addEventListener("click", () => {
    els.settingsPanel.classList.toggle("hidden");
  });

  els.syncToggle.addEventListener("change", handleSyncToggle);
  els.expansionToggle.addEventListener("change", handleExpansionToggle);
  els.exportBtn.addEventListener("click", exportSnippets);
  els.importInput.addEventListener("change", importSnippets);
  els.clearAllBtn.addEventListener("click", clearAll);
}

/* ---------- storage helpers ---------- */

function getArea() {
  return state.settings.syncEnabled ? chrome.storage.sync : chrome.storage.local;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || { syncEnabled: false, expansionEnabled: false };
}

async function loadSnippets() {
  const { snippets = [] } = await getArea().get("snippets");
  state.snippets = snippets;
}

async function persist() {
  try {
    await getArea().set({ snippets: state.snippets });
  } catch (err) {
    showToast("Storage full — try disabling sync or deleting old snippets");
  }
}

/* ---------- actions ---------- */

async function addManualSnippet() {
  const text = els.newSnippetText.value.trim();
  if (!text) return;

  const trigger = els.newSnippetTrigger.value.trim();
  if (trigger && state.snippets.some((s) => s.trigger === trigger)) {
    showToast(`"${trigger}" is already used by another snippet`);
    return;
  }

  state.snippets = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      trigger,
      source: "",
      createdAt: Date.now(),
      pinned: false
    },
    ...state.snippets
  ];
  els.newSnippetText.value = "";
  els.newSnippetTrigger.value = "";
  await persist();
  render();
}

async function setTrigger(id) {
  const snippet = state.snippets.find((s) => s.id === id);
  if (!snippet) return;

  const input = prompt("Trigger word (e.g. ;sig) — type without spaces. Leave blank to remove.", snippet.trigger || "");
  if (input === null) return; // cancelled

  const trigger = input.trim();
  if (trigger && state.snippets.some((s) => s.id !== id && s.trigger === trigger)) {
    showToast(`"${trigger}" is already used by another snippet`);
    return;
  }

  state.snippets = state.snippets.map((s) => (s.id === id ? { ...s, trigger } : s));
  await persist();
  render();
}

async function deleteSnippet(id) {
  state.snippets = state.snippets.filter((s) => s.id !== id);
  await persist();
  render();
}

async function togglePin(id) {
  state.snippets = state.snippets.map((s) =>
    s.id === id ? { ...s, pinned: !s.pinned } : s
  );
  await persist();
  render();
}

async function copySnippet(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  } catch {
    showToast("Couldn't copy — try selecting the text manually");
  }
}

async function clearAll() {
  if (!state.snippets.length) return;
  const ok = confirm(`Delete all ${state.snippets.length} saved snippets? This can't be undone.`);
  if (!ok) return;
  state.snippets = [];
  await persist();
  render();
}

async function handleSyncToggle(e) {
  const turningOn = e.target.checked;
  const fromArea = turningOn ? chrome.storage.local : chrome.storage.sync;
  const toArea = turningOn ? chrome.storage.sync : chrome.storage.local;

  const { snippets: existing = [] } = await fromArea.get("snippets");
  const { snippets: current = [] } = await toArea.get("snippets");

  // Merge, de-duplicating by id, newest first.
  const merged = dedupeById([...existing, ...current]).sort((a, b) => b.createdAt - a.createdAt);

  try {
    await toArea.set({ snippets: merged });
  } catch {
    showToast("Sync storage is full — staying on local storage");
    e.target.checked = false;
    return;
  }

  state.settings = { ...state.settings, syncEnabled: turningOn };
  await chrome.storage.local.set({ settings: state.settings });
  state.snippets = merged;
  render();
  showToast(turningOn ? "Sync turned on" : "Sync turned off");
}

async function handleExpansionToggle(e) {
  const turningOn = e.target.checked;

  if (turningOn) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    } catch {
      granted = false;
    }

    if (!granted) {
      e.target.checked = false;
      showToast("Permission needed for typed shortcuts to work");
      return;
    }

    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [EXPANDER_SCRIPT_ID] });
      if (existing.length === 0) {
        await chrome.scripting.registerContentScripts([
          {
            id: EXPANDER_SCRIPT_ID,
            matches: ["<all_urls>"],
            js: ["expander.js"],
            runAt: "document_idle",
            persistAcrossSessions: true
          }
        ]);
      }
    } catch {
      showToast("Couldn't enable typed shortcuts — try again");
      e.target.checked = false;
      return;
    }

    state.settings.expansionEnabled = true;
    await chrome.storage.local.set({ settings: state.settings });
    showToast("Typed shortcuts turned on");
  } else {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [EXPANDER_SCRIPT_ID] });
    } catch {
      // Script may not have been registered — fine either way.
    }
    try {
      await chrome.permissions.remove({ origins: ["<all_urls>"] });
    } catch {
      // Non-fatal if the browser won't release it (e.g. still granted elsewhere).
    }

    state.settings.expansionEnabled = false;
    await chrome.storage.local.set({ settings: state.settings });
    showToast("Typed shortcuts turned off");
  }
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

function exportSnippets() {
  const blob = new Blob([JSON.stringify(state.snippets, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clipzy-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importSnippets(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("Invalid format");

    const cleaned = imported
      .filter((s) => s && typeof s.text === "string")
      .map((s) => ({
        id: s.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: s.text,
        trigger: typeof s.trigger === "string" ? s.trigger : "",
        source: s.source || "",
        createdAt: s.createdAt || Date.now(),
        pinned: !!s.pinned
      }));

    state.snippets = dedupeById([...cleaned, ...state.snippets]).sort((a, b) => b.createdAt - a.createdAt);
    await persist();
    render();
    showToast(`Imported ${cleaned.length} snippet${cleaned.length === 1 ? "" : "s"}`);
  } catch {
    showToast("That file couldn't be imported");
  } finally {
    e.target.value = "";
  }
}

/* ---------- render ---------- */

function render() {
  const filtered = state.snippets
    .filter((s) => !state.query || s.text.toLowerCase().includes(state.query) || (s.source || "").toLowerCase().includes(state.query))
    .sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));

  els.list.innerHTML = "";
  els.emptyState.classList.toggle("hidden", state.snippets.length > 0);
  els.list.classList.toggle("hidden", filtered.length === 0);

  els.countLabel.textContent = `${state.snippets.length} snippet${state.snippets.length === 1 ? "" : "s"}${state.settings.syncEnabled ? " · synced" : ""}`;

  for (const snippet of filtered) {
    els.list.appendChild(buildCard(snippet));
  }
}

function buildCard(snippet) {
  const card = document.createElement("article");
  card.className = "snippet-card" + (snippet.pinned ? " pinned" : "");

  if (snippet.trigger) {
    const badge = document.createElement("span");
    badge.className = "snippet-trigger";
    badge.textContent = snippet.trigger;
    card.appendChild(badge);
  }

  const textEl = document.createElement("div");
  textEl.className = "snippet-text";
  textEl.textContent = snippet.text;

  const meta = document.createElement("div");
  meta.className = "snippet-meta";
  meta.innerHTML = `<span>${escapeHtml(snippet.source || "manual")}</span><span>${relativeTime(snippet.createdAt)}</span>`;

  const actions = document.createElement("div");
  actions.className = "snippet-actions";

  const copyBtn = makeBtn("copy-btn", "Copy", () => copySnippet(snippet.text));
  const pinBtn = makeBtn("pin-btn", snippet.pinned ? "Unpin" : "Pin", () => togglePin(snippet.id));
  const triggerBtn = makeBtn("trigger-btn", snippet.trigger ? "Edit trigger" : "Add trigger", () => setTrigger(snippet.id));
  const deleteBtn = makeBtn("delete-btn", "Delete", () => deleteSnippet(snippet.id));

  actions.append(copyBtn, pinBtn, triggerBtn, deleteBtn);
  card.append(textEl, meta, actions);

  // Expand/collapse long snippets
  requestAnimationFrame(() => {
    if (textEl.scrollHeight > textEl.clientHeight + 2) {
      const toggle = document.createElement("button");
      toggle.className = "expand-toggle";
      toggle.textContent = "Show more";
      toggle.addEventListener("click", () => {
        textEl.classList.toggle("expanded");
        toggle.textContent = textEl.classList.contains("expanded") ? "Show less" : "Show more";
      });
      card.insertBefore(toggle, meta);
    }
  });

  return card;
}

function makeBtn(cls, label, onClick) {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  // restart animation
  els.toast.style.animation = "none";
  void els.toast.offsetWidth;
  els.toast.style.animation = "";
  setTimeout(() => els.toast.classList.add("hidden"), 1600);
}
