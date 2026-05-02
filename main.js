const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

let folderWatcher    = null;
let folderWatchTimer = null;
let stabilityTimer   = null;

function getFolderSizes(folderPath) {
  try {
    return fs.readdirSync(folderPath)
      .map(f => { try { return fs.statSync(path.join(folderPath, f)).size; } catch { return -1; } })
      .join(',');
  } catch { return ''; }
}

function checkStable(folderPath, prevSizes = null, attempts = 0) {
  clearTimeout(stabilityTimer);
  const sizes = getFolderSizes(folderPath);
  if ((prevSizes !== null && sizes === prevSizes) || attempts >= 12) {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('folder-changed'));
  } else {
    stabilityTimer = setTimeout(() => checkStable(folderPath, sizes, attempts + 1), 400);
  }
}

function getStorePath() {
  return path.join(app.getPath('userData'), 'last-folder.json');
}
function saveLastFolder(folderPath) {
  try { fs.writeFileSync(getStorePath(), JSON.stringify({ folder: folderPath })); } catch {}
}
function loadLastFolder() {
  try {
    const data = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'));
    if (data?.folder && fs.existsSync(data.folder)) return data.folder;
  } catch {}
  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webSecurity: false,
    },
    backgroundColor: '#1a1a1a',
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen',  () => win.webContents.send('fullscreen-changed', false));
}

// ── PNG tEXt chunk parser ───────────────────────────────────────────────────
function parsePngTextChunks(filePath) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return {}; }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return {};

  const chunks = {};
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length    = buf.readUInt32BE(offset);
    const type      = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd   = dataStart + length;
    if (dataEnd + 4 > buf.length) break;
    if (type === 'tEXt') {
      const data    = buf.subarray(dataStart, dataEnd);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        chunks[data.toString('latin1', 0, nullIdx)] = data.toString('latin1', nullIdx + 1);
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return chunks;
}

// ── ComfyUI node-graph param extractor ─────────────────────────────────────

// Resolve a node-reference scalar (seed, cfg, etc.) that may be a literal value
// OR a reference to a seed/primitive node: e.g. ["40", 0]
function resolveScalar(graph, val) {
  if (typeof val === 'number') return val;
  if (!Array.isArray(val) || typeof val[0] !== 'string') return null;
  const node = graph[val[0]];
  if (!node) return null;
  const inp = node.inputs ?? {};
  // Try common output field names used by seed/primitive/value nodes
  for (const key of ['seed', 'noise_seed', 'value', 'int', 'float', 'number']) {
    if (typeof inp[key] === 'number') return inp[key];
  }
  return null;
}

// Follow the model connection chain (through LoRA loaders, etc.)
// to find the checkpoint name.
function resolveModelName(graph, nodeRef, depth = 0) {
  if (depth > 6) return null;
  if (!Array.isArray(nodeRef) || typeof nodeRef[0] !== 'string') return null;
  const node = graph[nodeRef[0]];
  if (!node) return null;
  if (node.inputs?.ckpt_name) return node.inputs.ckpt_name;
  if (node.inputs?.model_name) return node.inputs.model_name;
  // LoRA / model-pass-through nodes forward their model input
  if (Array.isArray(node.inputs?.model)) {
    return resolveModelName(graph, node.inputs.model, depth + 1);
  }
  return null;
}

// Scan all nodes in the graph for LoRA loaders and collect their names/strengths.
// Also logs unrecognised node class_types to help diagnose missing LoRAs.
function collectLoras(graph) {
  const loras = [];
  const classTypes = [...new Set(Object.values(graph).map(n => n?.class_type).filter(Boolean))];
  console.log('[collectLoras] class_types in graph:', classTypes);

  for (const node of Object.values(graph)) {
    const ct = node?.class_type ?? '';

    // Standard: LoraLoader, LoraLoaderModelOnly
    if (ct === 'LoraLoader' || ct === 'LoraLoaderModelOnly') {
      if (node.inputs?.lora_name != null) {
        loras.push({
          name: node.inputs.lora_name,
          strengthModel: node.inputs.strength_model ?? null,
          strengthClip:  node.inputs.strength_clip  ?? null,
        });
      }
      continue;
    }

    // Efficiency nodes: LoraLoaderStack — uses lora_name_1/lora_model_str_1/lora_clip_str_1 etc.
    if (ct === 'LoraLoaderStack') {
      for (let i = 1; i <= 10; i++) {
        const name = node.inputs?.[`lora_name_${i}`];
        if (!name || name === 'None') break;
        loras.push({
          name,
          strengthModel: node.inputs[`lora_model_str_${i}`] ?? null,
          strengthClip:  node.inputs[`lora_clip_str_${i}`]  ?? null,
        });
      }
      continue;
    }

    // rgthree lora nodes (Power Lora Loader, Lora Loader Stack, etc.)
    if (/lora.*\(rgthree\)/i.test(ct) || /power\s*lora/i.test(ct)) {
      const inp = node.inputs ?? {};
      // Flat layout: lora_01/"name" + strength_01/1 (Lora Loader Stack)
      for (const [k, v] of Object.entries(inp)) {
        if (/^lora_\d+$/.test(k) && typeof v === 'string' && v && v !== 'None') {
          const idx = k.slice('lora_'.length);
          loras.push({
            name: v,
            strengthModel: inp[`strength_${idx}`] ?? null,
            strengthClip:  null,
          });
          continue;
        }
        // Object layout: lora_1/{ lora: "name", strength: 1 } (Power Lora Loader)
        if (/^lora_\d+$/.test(k) && v && typeof v === 'object' && v.lora) {
          loras.push({
            name: v.lora,
            strengthModel: v.strength ?? null,
            strengthClip:  null,
          });
        }
      }
      continue;
    }

    // Generic fallback: any node whose class_type contains "lora" (case-insensitive)
    // and has a lora_name input — catches unknown custom nodes.
    if (/lora/i.test(ct) && node.inputs?.lora_name != null) {
      loras.push({
        name: node.inputs.lora_name,
        strengthModel: node.inputs.strength_model ?? node.inputs.model_strength ?? null,
        strengthClip:  node.inputs.strength_clip  ?? node.inputs.clip_strength  ?? null,
      });
    }
  }

  console.log('[collectLoras] found:', JSON.stringify(loras));
  return loras;
}

// Collect ALL prompt texts from a conditioning chain.
// Handles ConditioningCombine (both branches), known encode nodes,
// and exhaustively follows ALL node-ref inputs on unknown nodes
// so any custom/extension conditioning node is automatically traversed.
function collectPromptTexts(graph, nodeRef, depth = 0, visited = new Set()) {
  if (depth > 12) return [];
  if (!Array.isArray(nodeRef) || typeof nodeRef[0] !== 'string') return [];
  const nodeId = nodeRef[0];
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const node = graph[nodeId];
  if (!node) return [];

  switch (node.class_type) {
    case 'CLIPTextEncode':
      return typeof node.inputs?.text === 'string' ? [node.inputs.text] : [];
    case 'CLIPTextEncodeSDXL':
    case 'CLIPTextEncodeSDXLRefiner': {
      const t = node.inputs?.text_g || node.inputs?.text_l || node.inputs?.text;
      return t ? [t] : [];
    }
    case 'ConditioningCombine': {
      const t1 = collectPromptTexts(graph, node.inputs?.conditioning_1, depth + 1, new Set(visited));
      const t2 = collectPromptTexts(graph, node.inputs?.conditioning_2, depth + 1, new Set(visited));
      return [...t1, ...t2];
    }
    default: {
      // For any unknown node, exhaustively follow every input that is a node reference.
      // This catches IPAdapter, ControlNet, custom nodes, etc. automatically.
      const results = [];
      for (const val of Object.values(node.inputs ?? {})) {
        if (Array.isArray(val) && typeof val[0] === 'string') {
          const texts = collectPromptTexts(graph, val, depth + 1, new Set(visited));
          results.push(...texts);
        }
      }
      return results;
    }
  }
}

// Walk the latent chain to find the EmptyLatentImage node (returns the node or null).
function findEmptyLatentNode(graph, nodeRef, depth = 0) {
  if (depth > 6) return null;
  if (!Array.isArray(nodeRef) || typeof nodeRef[0] !== 'string') return null;
  const node = graph[nodeRef[0]];
  if (!node) return null;
  const ct = node.class_type ?? '';
  if (ct.startsWith('Empty') && ct.includes('Latent')) return node;
  if (ct.includes('Sampler')) return null;
  for (const key of ['latent_image', 'samples', 'latent']) {
    if (Array.isArray(node.inputs?.[key])) {
      const found = findEmptyLatentNode(graph, node.inputs[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Collect upscaler information from the graph.
// Covers: UpscaleModelLoader, LatentUpscaleBy/ImageScaleBy, LatentUpscale/ImageScale,
// UltimateSDUpscale, and any node whose class_type contains "upscale" (case-insensitive).
function collectUpscalerInfo(graph) {
  let upscaleModel     = null;
  let upscaleMethod    = null;
  let upscaleFactor    = null;
  let upscaleScheduler = null;
  let upscaleDenoise   = null;

  for (const node of Object.values(graph)) {
    const ct  = node?.class_type ?? '';
    const inp = node?.inputs ?? {};

    if (ct === 'UpscaleModelLoader') {
      if (inp.model_name) upscaleModel = inp.model_name;
      continue;
    }
    if (ct === 'LatentUpscaleBy' || ct === 'ImageScaleBy') {
      if (!upscaleMethod && inp.upscale_method) upscaleMethod = inp.upscale_method;
      if (upscaleFactor == null && inp.scale_by != null) upscaleFactor = inp.scale_by;
      continue;
    }
    if (ct === 'LatentUpscale' || ct === 'ImageScale') {
      if (!upscaleMethod && inp.upscale_method) upscaleMethod = inp.upscale_method;
      continue;
    }
    // UltimateSDUpscale and other custom upscale nodes
    if (/upscale/i.test(ct)) {
      if (!upscaleModel     && inp.upscale_model_name)              upscaleModel     = inp.upscale_model_name;
      if (!upscaleMethod    && inp.upscale_method)                  upscaleMethod    = inp.upscale_method;
      if (upscaleFactor  == null && inp.scale_factor  != null)      upscaleFactor    = inp.scale_factor;
      if (!upscaleScheduler && inp.scheduler)                       upscaleScheduler = inp.scheduler;
      if (upscaleDenoise == null && typeof inp.denoise === 'number') upscaleDenoise  = inp.denoise;
    }
  }

  return { upscaleModel, upscaleMethod, upscaleFactor, upscaleScheduler, upscaleDenoise };
}

// Walk the latent chain upward to check if it originates from an EmptyLatentImage
// (meaning this KSampler is the FIRST/primary generation pass, not a hires-fix pass)
function latentFromEmpty(graph, nodeRef, depth = 0) {
  if (depth > 6) return false;
  if (!Array.isArray(nodeRef) || typeof nodeRef[0] !== 'string') return false;
  const node = graph[nodeRef[0]];
  if (!node) return false;
  const ct = node.class_type ?? '';
  if (ct.startsWith('Empty') && ct.includes('Latent')) return true; // EmptyLatentImage etc.
  if (ct.includes('Sampler')) return false; // hit another sampler → this is not first
  // follow latent pass-through inputs
  for (const key of ['latent_image', 'samples', 'latent']) {
    if (Array.isArray(node.inputs?.[key])) {
      if (latentFromEmpty(graph, node.inputs[key], depth + 1)) return true;
    }
  }
  return false;
}

function extractComfyParams(promptJson) {
  let graph;
  try { graph = JSON.parse(promptJson); } catch { return null; }
  if (typeof graph !== 'object' || !graph) return null;

  const ksamplers = Object.entries(graph)
    .filter(([, n]) => n?.class_type === 'KSampler' || n?.class_type === 'KSamplerAdvanced')
    .map(([, n]) => n);

  if (ksamplers.length === 0) return null;

  // Prefer the KSampler whose latent traces back to an EmptyLatentImage —
  // that is the primary generation pass. Fall back to first found.
  const ksampler =
    ksamplers.find(n => latentFromEmpty(graph, n.inputs?.latent_image)) ??
    ksamplers[0];

  const inp      = ksampler.inputs ?? {};
  const posTexts = collectPromptTexts(graph, inp.positive);
  const negTexts = collectPromptTexts(graph, inp.negative);

  const loras = collectLoras(graph);

  const emptyLatent = findEmptyLatentNode(graph, inp.latent_image);
  const genWidth    = typeof emptyLatent?.inputs?.width  === 'number' ? emptyLatent.inputs.width  : null;
  const genHeight   = typeof emptyLatent?.inputs?.height === 'number' ? emptyLatent.inputs.height : null;

  const { upscaleModel, upscaleMethod, upscaleFactor, upscaleScheduler: uSched, upscaleDenoise: uDenoise } = collectUpscalerInfo(graph);

  // Secondary KSampler = hires-fix / upscale pass (any KSampler that is not the primary)
  const secondaryKsampler = ksamplers.find(n => n !== ksampler);
  const upscaleScheduler = uSched
    ?? secondaryKsampler?.inputs?.scheduler
    ?? null;
  const upscaleDenoise = uDenoise
    ?? (typeof secondaryKsampler?.inputs?.denoise === 'number' ? secondaryKsampler.inputs.denoise : null);

  return {
    model:          resolveModelName(graph, inp.model),
    loras:          loras.length > 0 ? loras : null,
    seed:           resolveScalar(graph, inp.seed) ?? resolveScalar(graph, inp.noise_seed) ?? null,
    steps:          typeof inp.steps === 'number' ? inp.steps : null,
    cfg:            typeof inp.cfg   === 'number' ? inp.cfg   : null,
    sampler:        inp.sampler_name  ?? null,
    scheduler:      inp.scheduler     ?? null,
    genWidth,
    genHeight,
    upscaleModel,
    upscaleMethod,
    upscaleFactor,
    upscaleScheduler,
    upscaleDenoise,
    positivePrompt: posTexts.length > 0 ? posTexts.join('\n') : null,
    negativePrompt: negTexts.length > 0 ? negTexts.join('\n') : null,
  };
}

// ── IPC handlers ───────────────────────────────────────────────────────────
ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  saveLastFolder(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('get-last-folder', () => loadLastFolder());

ipcMain.handle('delete-file', async (_, filePath) => {
  await shell.trashItem(filePath);
});

ipcMain.handle('get-file-info', (_, filePath) => {
  const s = fs.statSync(filePath);
  return { size: s.size, modified: s.mtime.toISOString(), created: s.birthtime.toISOString() };
});

ipcMain.handle('get-png-meta', (_, filePath) => {
  console.log('[get-png-meta] file:', filePath);
  if (path.extname(filePath).toLowerCase() !== '.png') {
    console.log('[get-png-meta] skipped - not .png');
    return null;
  }
  const chunks = parsePngTextChunks(filePath);
  console.log('[get-png-meta] chunk keys:', Object.keys(chunks));
  if (!chunks.prompt) {
    console.log('[get-png-meta] no prompt chunk found');
    return null;
  }
  const result = extractComfyParams(chunks.prompt);
  console.log('[get-png-meta] result:', JSON.stringify(result, null, 2));
  return result;
});

ipcMain.handle('set-watch-folder', (_, folderPath) => {
  if (folderWatcher) { folderWatcher.close(); folderWatcher = null; }
  clearTimeout(folderWatchTimer);
  clearTimeout(stabilityTimer);
  if (!folderPath) return;

  folderWatcher = fs.watch(folderPath, () => {
    clearTimeout(folderWatchTimer);
    clearTimeout(stabilityTimer);
    folderWatchTimer = setTimeout(() => checkStable(folderPath), 300);
  });
  folderWatcher.on('error', () => { folderWatcher = null; });
});

ipcMain.handle('read-folder', async (_, folderPath) => {
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif']);
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const subfolders = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, folderPath: path.join(folderPath, e.name) }));
  const images = entries
    .filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map(e => {
      const filePath = path.join(folderPath, e.name);
      const stat = fs.statSync(filePath);
      return { name: e.name, filePath, created: stat.birthtime.getTime() };
    });
  return { images, subfolders };
});

ipcMain.handle('toggle-fullscreen', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.setFullScreen(!win.isFullScreen());
});

// ── Character library (Phase 5) ────────────────────────────────────────────
const CHARS_DIR = path.resolve(__dirname, '..', 'local gen knowledge base', 'prompts-booru', 'characters');

function walkCharFiles(dirPath, series, subPath, out) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      walkCharFiles(full, series, subPath ? path.join(subPath, e.name) : e.name, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push({
        series,
        name: path.basename(e.name, '.md'),
        path: full,
        multi: subPath === 'multi-character' || subPath?.startsWith('multi-character'),
      });
    }
  }
}

ipcMain.handle('list-characters', () => {
  if (!fs.existsSync(CHARS_DIR)) return { dir: CHARS_DIR, items: [] };
  const items = [];
  const seriesDirs = fs.readdirSync(CHARS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory());
  for (const sd of seriesDirs) walkCharFiles(path.join(CHARS_DIR, sd.name), sd.name, '', items);
  items.sort((a, b) => a.series.localeCompare(b.series) || a.name.localeCompare(b.name));
  return { dir: CHARS_DIR, items };
});

ipcMain.handle('read-character', (_, filePath) => {
  if (!filePath || !filePath.startsWith(CHARS_DIR)) return null;
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
});

// ── Presets (Phase 4.2/4.3) ────────────────────────────────────────────────
const PRESETS_DIR = path.resolve(__dirname, '..', 'shared', 'presets');
const sanitizeName = (s) => s.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();

ipcMain.handle('list-presets', () => {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  try {
    return fs.readdirSync(PRESETS_DIR)
      .filter(f => f.toLowerCase().endsWith('.json'))
      .map(f => path.basename(f, '.json'));
  } catch { return []; }
});

ipcMain.handle('read-preset', (_, name) => {
  const safe = sanitizeName(name || '');
  if (!safe) return null;
  const file = path.join(PRESETS_DIR, safe + '.json');
  if (!file.startsWith(PRESETS_DIR)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
});

ipcMain.handle('save-preset', (_, { name, data }) => {
  const safe = sanitizeName(name || '');
  if (!safe) return { ok: false, error: 'invalid name' };
  const file = path.join(PRESETS_DIR, safe + '.json');
  if (!file.startsWith(PRESETS_DIR)) return { ok: false, error: 'path escape' };
  try {
    fs.mkdirSync(PRESETS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: file };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('delete-preset', (_, name) => {
  const safe = sanitizeName(name || '');
  if (!safe) return { ok: false, error: 'invalid name' };
  const file = path.join(PRESETS_DIR, safe + '.json');
  if (!file.startsWith(PRESETS_DIR)) return { ok: false, error: 'path escape' };
  try { fs.unlinkSync(file); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('save-character', (_, { series, name, content }) => {
  if (!series || !name || !content) return { ok: false, error: 'missing fields' };
  const safe = (s) => s.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
  const sSeries = safe(series);
  const sName   = safe(name);
  if (!sSeries || !sName) return { ok: false, error: 'invalid series or name' };
  const dir  = path.join(CHARS_DIR, sSeries);
  const file = path.join(dir, sName + '.md');
  if (!file.startsWith(CHARS_DIR)) return { ok: false, error: 'path escape' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => {
  if (folderWatcher) { folderWatcher.close(); folderWatcher = null; }
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
