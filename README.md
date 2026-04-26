# comfy-gallery

A desktop image gallery for **ComfyUI** outputs. Browse local folders, inspect embedded generation metadata, and compare images side by side — all in a native Electron window.

## Features

- **Folder browser** — open any local folder, navigate into subfolders, and go back up; last folder is restored on launch
- **Auto-refresh** — watches the folder for new files and updates the grid automatically (waits for writes to settle before refreshing)
- **ComfyUI metadata** — reads generation parameters embedded in PNG files: model, LoRAs, seed, steps, CFG, sampler, scheduler, resolution, upscaler, positive/negative prompts
- **Lightbox** — full-size image view with keyboard navigation (← →), delete (Del), and Escape to close
- **Compare panel** — select multiple images and view them side by side
- **View options** — original aspect ratio, large grid, resolution overlay, group-by-seed; settings are persisted
- **Full-screen** — toggle with F11
- **Delete to trash** — uses the OS recycle bin, not permanent deletion

## Stack

- [Electron](https://www.electronjs.org/) 29
- [React](https://react.dev/) 18 + [Vite](https://vitejs.dev/) 5
- [electron-builder](https://www.electron.build/) for packaging

## Getting started

```bash
npm install

# Development (Vite dev server + Electron)
npm run dev

# Production build + run
npm start

# Package to installer
npm run dist
```

The installer is written to `release/`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| ← / → | Previous / next image in lightbox |
| Escape | Close lightbox |
| Delete | Move current image to trash |
| F11 | Toggle full-screen |
