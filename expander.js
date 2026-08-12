// expander.js — ClipZy typed-trigger expansion
//
// This file is only ever injected if the user has explicitly turned on
// "Typed shortcuts" in the ClipZy side panel, which grants the extra
// host permission this requires. It is NOT part of ClipZy's default
// install footprint.
//
// Behaviour: type a snippet's trigger (e.g. ";sig") then press space,
// tab, or enter, and the trigger is replaced with the saved text. If the
// text contains a {{placeholder}}, it's selected afterwards so you can
// just type over it.

(function () {
  if (window.__clipzyExpanderInstalled) return;
  window.__clipzyExpanderInstalled = true;

  const BOUNDARY_KEYS = { " ": " ", "Enter": "\n", "Tab": "\t" };

  let triggerMap = {};
  let maxTriggerLen = 0;

  loadTriggers();
  chrome.storage.onChanged.addListener(loadTriggers);
  document.addEventListener("keydown", onKeydown, true);

  async function loadTriggers() {
    try {
      const { settings } = await chrome.storage.local.get("settings");
      const syncEnabled = settings?.syncEnabled;
      const area = syncEnabled ? chrome.storage.sync : chrome.storage.local;
      const { snippets = [] } = await area.get("snippets");

      const map = {};
      let maxLen = 0;
      for (const s of snippets) {
        const trigger = (s.trigger || "").trim();
        if (trigger) {
          map[trigger] = s.text;
          maxLen = Math.max(maxLen, trigger.length);
        }
      }
      triggerMap = map;
      maxTriggerLen = maxLen;
    } catch {
      // Extension context can go away on reload/update — fail quietly.
    }
  }

  function onKeydown(e) {
    const boundaryChar = BOUNDARY_KEYS[e.key];
    if (boundaryChar === undefined) return;
    if (maxTriggerLen === 0) return;

    const el = document.activeElement;
    if (!el) return;

    const isField =
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && /^(text|search|url|tel|email)$/i.test(el.type || "text"));
    const isEditable = !isField && el.isContentEditable;
    if (!isField && !isEditable) return;

    const before = getTextBeforeCursor(el, isField);
    const match = findTrigger(before);
    if (!match) return;

    e.preventDefault();
    e.stopPropagation();

    if (isField) {
      expandInField(el, match, boundaryChar);
    } else {
      expandInContentEditable(match, boundaryChar);
    }
  }

  function findTrigger(before) {
    for (let len = Math.min(maxTriggerLen, before.length); len > 0; len--) {
      const candidate = before.slice(before.length - len);
      if (Object.prototype.hasOwnProperty.call(triggerMap, candidate)) {
        return { trigger: candidate, text: triggerMap[candidate] };
      }
    }
    return null;
  }

  function getTextBeforeCursor(el, isField) {
    if (isField) {
      const pos = el.selectionStart ?? el.value.length;
      return el.value.slice(0, pos);
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return "";
    // Only reliable within a single text node — good enough for most
    // simple contentEditable fields; complex rich editors may not match.
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return "";
    return node.textContent.slice(0, sel.anchorOffset);
  }

  function expandInField(el, match, boundaryChar) {
    const pos = el.selectionStart ?? el.value.length;
    const start = pos - match.trigger.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(pos);
    el.value = before + match.text + boundaryChar + after;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    selectPlaceholderOrCollapse(el, before.length, match.text);
  }

  function expandInContentEditable(match, boundaryChar) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    const offset = sel.anchorOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const start = offset - match.trigger.length;
    if (start < 0) return;

    const fullText = node.textContent;
    node.textContent = fullText.slice(0, start) + match.text + boundaryChar + fullText.slice(offset);

    const placeholder = match.text.match(/\{\{[^{}]+\}\}/);
    const range = document.createRange();
    if (placeholder) {
      range.setStart(node, start + placeholder.index);
      range.setEnd(node, start + placeholder.index + placeholder[0].length);
    } else {
      const caret = start + match.text.length + boundaryChar.length;
      range.setStart(node, caret);
      range.setEnd(node, caret);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    node.parentElement?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function selectPlaceholderOrCollapse(el, insertOffset, text) {
    const placeholder = text.match(/\{\{[^{}]+\}\}/);
    if (placeholder) {
      const start = insertOffset + placeholder.index;
      el.setSelectionRange(start, start + placeholder[0].length);
    } else {
      const pos = insertOffset + text.length + 1; // +1 for the boundary char
      el.setSelectionRange(pos, pos);
    }
  }
})();
