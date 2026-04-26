# comfy-gallery

A desktop image gallery app built with **Electron + React + Vite**, designed for browsing and inspecting AI-generated images from ComfyUI.

## What it does

- Opens a local folder and displays all images in a responsive grid
- Remembers the last opened folder across sessions
- Watches the folder for new files and auto-refreshes without user action
- Lightbox view for full-size image inspection with keyboard navigation (arrow keys, Escape, Delete)
- Side-by-side compare panel for selected images
- Subfolder navigation (browse into / navigate up)
- Reads ComfyUI generation metadata embedded in PNG `tEXt` chunks and displays:
  - Model / checkpoint name (resolves through LoRA loader chains)
  - LoRA names and strengths (supports standard, LoraLoaderStack, rgthree/Power Lora Loader, and generic fallbacks)
  - Seed, steps, CFG, sampler, scheduler
  - Generation resolution (from EmptyLatentImage node)
  - Upscaler model, method, factor, and hires-fix denoise/scheduler
  - Positive and negative prompts (follows ConditioningCombine chains and unknown custom nodes)
- Groups images by seed+prompt in grid view (optional)
- View options: original aspect ratio, large grid, resolution overlay, group-by-seed — persisted in localStorage
- Full-screen toggle (F11)
- Delete to trash via Electron `shell.trashItem`
- ComfyUI tab (separate panel in the UI)

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 29 |
| Frontend | React 18, Vite 5 |
| IPC | Electron contextBridge / preload |
| Build / dist | electron-builder (NSIS installer for Windows) |
| Dev runner | concurrently + wait-on |

## Project layout

```
main.js          # Electron main process — IPC handlers, PNG parser, ComfyUI graph walker
preload.js       # contextBridge API surface exposed to renderer
renderer.js      # (legacy entry, Vite now owns the renderer)
src/
  App.jsx        # Root component — state, keyboard shortcuts, folder watcher, nav logic
  App.css
  components/
    Toolbar.jsx      # Top bar: folder open, refresh, nav, view toggles, tab switcher
    Grid.jsx         # Image grid + subfolder tiles
    Lightbox.jsx     # Full-screen image viewer
    ComparePanel.jsx # Side-by-side image comparison
    ComfyUITab.jsx   # ComfyUI-specific tab panel
vite.config.js   # Vite config (React plugin)
index.html       # HTML entry for Vite
```

## Key behaviours / non-obvious details

- **Stability check**: the folder watcher debounces `fs.watch` events and polls file sizes every 400 ms (up to 12 times) before triggering a refresh, so partially-written images are not shown mid-write.
- **Primary KSampler selection**: when a workflow has multiple KSamplers (e.g. hires-fix), the one whose latent chain traces back to an `EmptyLatentImage` is treated as the primary generation pass.
- **Prompt collection**: follows the conditioning graph exhaustively through unknown custom nodes by traversing any input that is a node reference, so custom IPAdapter/ControlNet setups are handled automatically.
- **`webSecurity: false`** is set in the BrowserWindow to allow loading local `file://` images from arbitrary paths.
