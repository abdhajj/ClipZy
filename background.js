// background.js — ClipZy
// Builds the right-click menu (save selection + a live submenu of every
// saved snippet for instant paste-back), handles the toolbar icon opening
// the side panel, and handles the Alt+Shift+1..4 pinned-snippet shortcuts.
// Typed-trigger expansion lives in expander.js, injected only when the
// person opts into it from Settings (see sidepanel.js).

const ROOT_ID = "clipzy-root";
const SAVE_ID = "clipzy-save-selection";
const OPEN_PANEL_ID = "clipzy-open-panel";
const EMPTY_ID = "clipzy-empty";
const ITEM_PREFIX = "clipzy-item-";
const MAX_MENU_ITEMS = 15;

chrome.runtime.onInstalled.addListener(() => {
  buildMenu();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onStartup?.addListener(buildMenu);

// Rebuild the "paste back" submenu whenever snippets change, so the
// right-click menu always reflects what's currently saved.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (changes.snippets && (areaName === "local" || areaName === "sync")) {
    buildMenu();
  }
});

async function buildMenu() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: ROOT_ID,
    title: "ClipZy",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: SAVE_ID,
    parentId: ROOT_ID,
    title: 'Save "%s"',
    contexts: ["selection"]
  });

  const snippets = await getSnippets();

  if (snippets.length === 0) {
    chrome.contextMenus.create({
      id: EMPTY_ID,
      parentId: ROOT_ID,
      title: "Nothing saved yet",
      enabled: false,
      contexts: ["all"]
    });
  } else {
    chrome.contextMenus.create({ id: "clipzy-sep-1", parentId: ROOT_ID, type: "separator", contexts: ["all"] });

    const sorted = [...snippets].sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
    for (const snippet of sorted.slice(0, MAX_MENU_ITEMS)) {
      const star = snippet.pinned ? "\u2605 " : "";
      const triggerTag = snippet.trigger ? `[${snippet.trigger}] ` : "";
      chrome.contextMenus.create({
        id: ITEM_PREFIX + snippet.id,
        parentId: ROOT_ID,
        title: star + triggerTag + truncate(snippet.text),
        contexts: ["all"]
      });
    }
  }

  chrome.contextMenus.create({ id: "clipzy-sep-2", parentId: ROOT_ID, type: "separator", contexts: ["all"] });
  chrome.contextMenus.create({
    id: OPEN_PANEL_ID,
    parentId: ROOT_ID,
    title: "Open ClipZy panel\u2026",
    contexts: ["all"]
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === SAVE_ID) {
    await saveSnippet(info.selectionText, tab);
    return;
  }

  if (info.menuItemId === OPEN_PANEL_ID) {
    if (tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }

  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith(ITEM_PREFIX)) {
    const id = info.menuItemId.slice(ITEM_PREFIX.length);
    const snippets = await getSnippets();
    const snippet = snippets.find((s) => s.id === id);
    if (snippet && tab?.id != null) {
      await pasteIntoTab(tab.id, snippet.text);
    }
  }
});

// Alt+Shift+1..4 — paste one of your top 4 pinned snippets with zero clicks.
chrome.commands.onCommand.addListener(async (command) => {
  const match = /^paste-pinned-(\d)$/.exec(command);
  if (!match) return;
  const index = Number(match[1]) - 1;

  const snippets = await getSnippets();
  const pinned = snippets
    .filter((s) => s.pinned)
    .sort((a, b) => b.createdAt - a.createdAt);
  const snippet = pinned[index];
  if (!snippet) {
    flashBadge("?", "#cf5a5a");
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id != null) {
    await pasteIntoTab(activeTab.id, snippet.text);
  }
});

async function saveSnippet(rawText, tab) {
  const text = (rawText || "").trim();
  if (!text) return;

  const settings = await getSettings();
  const area = settings.syncEnabled ? chrome.storage.sync : chrome.storage.local;
  const snippets = await getSnippets();

  const snippet = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    source: tab?.url ? safeHostname(tab.url) : "",
    createdAt: Date.now(),
    pinned: false
  };

  const updated = [snippet, ...snippets];

  try {
    await area.set({ snippets: updated });
  } catch (err) {
    // chrome.storage.sync quota (8KB/item, 100KB total) — never lose the snippet.
    const { snippets: local = [] } = await chrome.storage.local.get("snippets");
    await chrome.storage.local.set({ snippets: [snippet, ...local] });
  }

  flashBadge("\u2713", "#22c55e");
}

async function pasteIntoTab(tabId, text) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: insertTextIntoPage,
      args: [text]
    });
    const outcome = result?.result;
    if (outcome === "pasted") flashBadge("\u21b5", "#3f8b7c");
    else if (outcome === "copied") flashBadge("\u2713", "#e2a33d");
    else flashBadge("!", "#cf5a5a");
  } catch (err) {
    flashBadge("!", "#cf5a5a");
  }
}

// Runs inside the target page. Inserts text at the caret if the focused
// element is editable, otherwise falls back to writing the clipboard.
// If the text contains a {{placeholder}}, it's selected afterwards so
// the person can immediately type over it.
function insertTextIntoPage(text) {
  const el = document.activeElement;
  const isTextField =
    el && el.tagName === "TEXTAREA" ||
    (el && el.tagName === "INPUT" && /^(text|search|url|tel|email|password|number)$/i.test(el.type || "text"));

  if (isTextField) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.dispatchEvent(new Event("input", { bubbles: true }));

    const placeholder = text.match(/\{\{[^{}]+\}\}/);
    if (placeholder) {
      el.setSelectionRange(start + placeholder.index, start + placeholder.index + placeholder[0].length);
    } else {
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    }
    return "pasted";
  }

  if (el && el.isContentEditable) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);

      const placeholder = text.match(/\{\{[^{}]+\}\}/);
      if (placeholder) {
        range.setStart(node, placeholder.index);
        range.setEnd(node, placeholder.index + placeholder[0].length);
      } else {
        range.setStartAfter(node);
        range.setEndAfter(node);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.textContent += text;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "pasted";
  }

  navigator.clipboard.writeText(text).catch(() => {});
  return "copied";
}

function truncate(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 45 ? oneLine.slice(0, 45) + "\u2026" : oneLine;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function getSnippets() {
  const settings = await getSettings();
  const area = settings.syncEnabled ? chrome.storage.sync : chrome.storage.local;
  const { snippets = [] } = await area.get("snippets");
  return snippets;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || { syncEnabled: false };
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1200);
}
