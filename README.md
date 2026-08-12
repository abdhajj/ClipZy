# ClipZy: Your CTRL Stash

A simple browser extension for people who copy-paste the same text over
and over — email signatures, template replies, addresses, code snippets, license
keys, a character's name in Japanese, anything.

- **Save instantly**: select any text on a page, right-click **ClipZy** →
  **"Save…"**.
- **Paste back instantly**: right-click any text field, hover **ClipZy ▸**,
  and click a saved snippet — it's inserted right where your cursor was.
  No copy step, no side panel required.
- **Type it out** *(opt-in)*: give a snippet a trigger like `;sig` and just
  type it anywhere, followed by space/tab/enter, to expand it automatically.
- **Fill-in-the-blank snippets**: use `{{name}}` in a snippet and it's
  auto-selected after pasting so you can type straight over it.
- **Keyboard shortcuts**: `Alt+Shift+1`–`4` instantly pastes one of your top
  4 pinned snippets — no menu, no click.
- **Browse everything**: click the toolbar icon to open a side panel listing
  every snippet, with search, pin, copy and delete.
- **Local by default**, with an optional **sync toggle** that uses your
  browser's built-in account sync (Chrome Sync / Edge Sync / Vivaldi Sync) so
  your snippets follow you to another computer signed into the same account.
  No external server, no account to create, no data sent to any third party.
- **Export / import** your snippets as a JSON file any time.

Works on **Chrome, Edge, Vivaldi**, and any other Chromium-based browser that
supports Manifest V3 extensions and the Side Panel API.

## Install (unpacked, for development or personal use)

1. Download or clone this repository.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Vivaldi: `vivaldi://extensions`
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `snippet-vault` folder.
5. Pin the extension to your toolbar so the icon is easy to reach.

## How to use it

1. **Save text**: highlight text on any web page → right-click → **ClipZy**
   → **"Save…"**. A green checkmark badge confirms it saved.
2. **Paste it back**: right-click inside any text box, search bar, or
   editable field → hover **ClipZy ▸** → click the snippet you want. It's
   inserted at your cursor immediately — this is the fast Ctrl+C/Ctrl+V
   replacement. Right-clicking somewhere that *isn't* a text field copies the
   snippet to your clipboard instead, so `Ctrl+V` still works right after.
   Pinned snippets (★) and your 15 most recent show in the menu; everything
   else is one click away in the full panel.
3. **Open the full panel**: click the ClipZy icon in the toolbar, or choose
   **"Open ClipZy panel…"** at the bottom of the right-click menu. The panel
   stays open as you browse other tabs.
   > Browsers only allow extension panels to open on a real click, not on
   > hover — that's a platform restriction (for security/privacy reasons),
   > not a limitation of this extension.
4. In the panel: **Copy** any card back to your clipboard, **pin** important
   snippets to keep them at the top (and in the right-click menu), **delete**
   ones you no longer need, or use the **search bar** to filter by content or
   by the site you copied it from.
5. **Add text manually** any time using the box at the top of the panel — you
   don't have to copy it from a web page first.
6. Open **Settings** (gear icon) to turn on **cross-device sync**, or to
   **export/import** your snippets as JSON, or to **clear everything**.

## About sync / cloud storage

This extension keeps things simple and privacy-friendly: instead of running
its own backend, it uses `chrome.storage.sync`, the sync mechanism already
built into Chrome/Edge/Vivaldi. When you turn on **Sync across my devices**:

- Your snippets sync through your browser's own account system — the same
  system that syncs your bookmarks and passwords.
- Nothing is sent to any server operated by this extension.
- The browser sync API has quota limits (roughly 100KB total, ~8KB per
  snippet, ~100 items). Very large snippet collections should stay on local
  storage — the extension will warn you and fall back to local storage
  automatically if a sync write fails.

If you'd rather build true cloud storage (e.g. Firebase, Supabase) so
snippets sync even across different browser accounts, see
[`docs/cloud-storage-notes.md`](docs/cloud-storage-notes.md) — it's a natural
next step but requires a backend and an account system, which is out of
scope for this lightweight version.

## Project structure

```
snippet-vault/
├── manifest.json       # Manifest V3 config
├── background.js       # Context menu (save + paste-back submenu) + save logic
├── sidepanel.html       # Side panel UI
├── sidepanel.css        # Side panel styling
├── sidepanel.js          # Side panel logic (CRUD, search, sync, export)
├── icons/                # Toolbar / store icons
└── generate_icons.py     # Script used to generate icons/*.png
```

## Permissions used, and why

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Builds the "ClipZy" right-click menu and its paste-back submenu. |
| `storage` | Saves your snippets locally (and to sync storage, if enabled). |
| `sidePanel` | Shows the saved-snippets panel when you click the toolbar icon. |
| `activeTab` | Lets a right-click menu click or keyboard shortcut insert text into the page you're in. |
| `scripting` | Runs the small script that inserts the snippet at your cursor. |
| `<all_urls>` *(optional)* | Only requested if you turn on **Typed shortcuts** in Settings — needed so the trigger-expansion script can run on the page you're typing on. Off by default. |

No permission is requested at install time beyond the first five, and none of
them involve reading your browsing history, other tabs, or anything beyond
the tab you're actively interacting with. `activeTab` + `scripting` only
activate for the specific tab you right-clicked in or pressed a shortcut in,
and only at that moment — never in the background. There are no network
requests and no analytics anywhere in this codebase.

## License
MIT — see [LICENSE](LICENSE).
