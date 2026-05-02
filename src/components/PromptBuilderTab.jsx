import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import treeData from '@shared/group_tags.json';
import flatData from '@shared/group_tags_flat.json';
import allBooruData from '@shared/all_booru_tags.json';
import qualityData from '@shared/quality_tags.json';
import sceneEffectData from '@shared/scene_effect_tags.json';

const MODEL_CATEGORY = {
  'WAI-Illustrious-SDXL': 'anime',
  'CyberIllustrious': 'realistic',
  'Anima': 'anime',
};

const GROUP_ORDER = [
  { id: 'quality-before',      label: 'Quality (before)' },
  { id: 'count',               label: 'Count' },
  { id: 'arrangement',         label: 'Arrangement' },
  { id: 'character',           label: 'Character' },
  { id: 'series',              label: 'Series' },
  { id: 'appearance',          label: 'Appearance' },
  { id: 'attire',              label: 'Attire' },
  { id: 'expression',          label: 'Expression' },
  { id: 'pose-action',         label: 'Pose / Action' },
  { id: 'composition-framing', label: 'Composition / Framing' },
  { id: 'background-setting',  label: 'Background / Setting' },
  { id: 'scene-lighting',      label: 'Scene / Lighting' },
  { id: 'effects',             label: 'Effects' },
  { id: 'style-artist',        label: 'Style / Artist' },
  { id: 'quality-after',       label: 'Quality (after)' },
];

const MODELS = Object.keys(qualityData);
const NEW_CHIP = (tag) => ({ tag, enabled: true, weight: 1 });
const CLAMP_W = (w) => Math.max(0.1, Math.min(2.0, Math.round(w * 100) / 100));

const flatByTag = (() => {
  const m = new Map();
  for (const t of flatData) if (!m.has(t.tag)) m.set(t.tag, t);
  return m;
})();

const fxByTag = (() => {
  const m = new Map();
  for (const cat of sceneEffectData.categories) {
    for (const t of cat.tags) if (!m.has(t.tag)) m.set(t.tag, t);
  }
  return m;
})();

// Quality tags from `quality_tags.json` keyed by normalized (underscored) form.
const qualityByTag = (() => {
  const m = new Map();
  const add = (tag, group) => m.set(tag.replace(/ /g, '_'), group);
  for (const data of Object.values(qualityData)) {
    for (const tag of data.before || []) add(tag, 'quality-before');
    for (const tag of data.after  || []) add(tag, 'quality-after');
  }
  return m;
})();

// Resolve canonical group(s) for a tag — checks curated tree, FX library, and quality presets.
function resolveGroups(tag) {
  const groups = [];
  const flatG = flatByTag.get(tag)?.group;
  const fxG   = fxByTag.get(tag)?.group;
  const qG    = qualityByTag.get(tag);
  if (flatG) groups.push(flatG);
  if (fxG && !groups.includes(fxG)) groups.push(fxG);
  if (qG  && !groups.includes(qG))  groups.push(qG);
  return groups;
}

// Mutually-exclusive tag sets — having >1 enabled simultaneously is conflicting
const CONFLICT_GROUPS = [
  { name: 'girl count',     tags: ['1girl', '2girls', '3girls', '4girls', '5girls', '6+girls'] },
  { name: 'boy count',      tags: ['1boy',  '2boys',  '3boys',  '4boys',  '5boys',  '6+boys'] },
  { name: 'solo vs multi',  tags: ['solo', '2girls', '2boys', 'multiple_girls', 'multiple_boys', 'multiple_others'] },
  { name: 'indoor/outdoor', tags: ['indoors', 'outdoors'] },
  { name: 'day/night',      tags: ['day', 'night'] },
];

// "Essential" groups in priority order — used to suggest the next missing one
const ESSENTIAL_GROUPS = ['count', 'arrangement', 'character', 'appearance', 'attire', 'pose-action'];

const isSection = (obj) =>
  obj && typeof obj === 'object' && 'group' in obj && 'nsfw' in obj && 'tags' in obj;

function transformTagBase(tag) {
  return tag.replace(/_/g, ' ').replace(/([()])/g, '\\$1');
}

function fmtWeight(w) {
  return String(Math.round(w * 100) / 100);
}

function formatChip(chip) {
  const base = transformTagBase(chip.tag);
  return chip.weight === 1 ? base : `(${base}:${fmtWeight(chip.weight)})`;
}

const UNKNOWN_GROUP = '_unknown';

function buildPrompt(chipsByGroup) {
  const parts = [];
  for (const { id } of GROUP_ORDER) {
    for (const chip of chipsByGroup[id] || []) {
      if (chip.enabled) parts.push(formatChip(chip));
    }
  }
  for (const chip of chipsByGroup[UNKNOWN_GROUP] || []) {
    if (chip.enabled) parts.push(formatChip(chip));
  }
  return parts.join(', ');
}

// Extract `## Final Prompt` section body from a character md file.
function extractFinalPromptFromMd(md) {
  const lines = md.split(/\r?\n/);
  const collected = [];
  let inFinal = false;
  for (const line of lines) {
    if (/^##\s+Final\s+Prompt\b/i.test(line)) { inFinal = true; continue; }
    if (inFinal) {
      if (/^#{2,}\s/.test(line)) break;
      if (/^----+\s*$/.test(line)) break;
      collected.push(line);
    }
  }
  return collected.join('\n').trim();
}

function generateCharacterMd(name, chipsByGroup, finalPrompt, allBooruData) {
  const lines = [`# ${name}`, ''];
  for (const { id, label } of GROUP_ORDER) {
    const chips = chipsByGroup[id] || [];
    if (!chips.length) continue;
    lines.push(`## ${label}`);
    for (const c of chips) {
      const w = c.weight !== 1 ? ` (×${c.weight})` : '';
      const off = c.enabled ? '' : ' [disabled]';
      lines.push(`- ${c.tag}${w}${off}`);
    }
    lines.push('');
  }
  const unknown = chipsByGroup[UNKNOWN_GROUP] || [];
  if (unknown.length) {
    lines.push('## Unknown / Unmatched');
    for (const c of unknown) {
      const w = c.weight !== 1 ? ` (×${c.weight})` : '';
      const off = c.enabled ? '' : ' [disabled]';
      lines.push(`- ${c.tag}${w}${off}`);
    }
    lines.push('');
  }
  lines.push('## Final Prompt');
  lines.push(finalPrompt);
  lines.push('');
  lines.push('### Tag counts');
  for (const arr of Object.values(chipsByGroup)) {
    for (const c of arr) {
      if (!c.enabled) continue;
      const count = allBooruData[c.tag] ?? 0;
      lines.push(`- ${c.tag}: ${count}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// Parse a prompt string back into chips grouped by canonical group.
// Tags not in the curated library land in UNKNOWN_GROUP, preserving order.
function parsePrompt(text) {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  const groups = {};
  for (const part of parts) {
    let raw = part;
    let weight = 1;
    const wm = raw.match(/^\((.+):\s*(-?[\d.]+)\s*\)$/);
    if (wm) {
      raw = wm[1].trim();
      const w = parseFloat(wm[2]);
      if (!Number.isNaN(w)) weight = CLAMP_W(w);
    }
    raw = raw.replace(/\\([()])/g, '$1');
    const underscored = raw.replace(/ /g, '_');
    let tag;
    if (flatByTag.has(underscored) || fxByTag.has(underscored) || qualityByTag.has(underscored)) tag = underscored;
    else tag = raw;
    const groupsForTag = resolveGroups(tag);
    const group = groupsForTag[0] || UNKNOWN_GROUP;
    if (!groups[group]) groups[group] = [];
    if (groups[group].some((c) => c.tag === tag)) continue;
    groups[group].push({ tag, enabled: true, weight });
  }
  return groups;
}

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'k';
  return String(n);
}

function nodeHasVisibleSection(node, showNsfw) {
  if (isSection(node)) return showNsfw || !node.nsfw;
  if (node && typeof node === 'object') {
    return Object.values(node).some((v) => nodeHasVisibleSection(v, showNsfw));
  }
  return false;
}

function TreeNode({ name, node, depth, expanded, onToggle, onAddTag, addedTags, highlightedTag, showNsfw, path }) {
  if (isSection(node)) {
    if (node.nsfw && !showNsfw) return null;
    const isOpen = expanded.has(path);
    return (
      <div>
        <div className="pb-tree-row pb-tree-section-row" style={{ paddingLeft: depth * 12 + 6 }} onClick={() => onToggle(path)}>
          <span className="pb-tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="pb-tree-section-name">{name}</span>
          <span className="pb-tree-section-meta">
            {node.tags.length}{node.nsfw ? ' • nsfw' : ''}
          </span>
        </div>
        {isOpen && (
          <div className="pb-tree-tags">
            {node.tags.map((t) => {
              const added = addedTags.has(t.tag);
              const highlighted = highlightedTag === t.tag;
              return (
                <button
                  key={t.tag}
                  data-tag-name={t.tag}
                  className={`pb-tree-tag${added ? ' added' : ''}${highlighted ? ' highlighted' : ''}`}
                  style={{ paddingLeft: (depth + 1) * 12 + 22 }}
                  onClick={() => onAddTag(t.tag, node.group)}
                  title={added ? `Click to remove · ${t.description || t.tag}` : (t.description || t.tag)}
                >
                  <span className="pb-tag-name">{t.tag}</span>
                  {t.count > 0 && <span className="pb-tag-count">{formatCount(t.count)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  if (node && typeof node === 'object') {
    if (!nodeHasVisibleSection(node, showNsfw)) return null;
    const isOpen = expanded.has(path);
    return (
      <div>
        <div className="pb-tree-row pb-tree-folder-row" style={{ paddingLeft: depth * 12 + 6 }} onClick={() => onToggle(path)}>
          <span className="pb-tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="pb-tree-folder-name">{name}</span>
        </div>
        {isOpen && Object.entries(node).map(([k, v]) => (
          <TreeNode
            key={k}
            name={k}
            node={v}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onAddTag={onAddTag}
            addedTags={addedTags}
            highlightedTag={highlightedTag}
            showNsfw={showNsfw}
            path={`${path}/${k}`}
          />
        ))}
      </div>
    );
  }
  return null;
}

function Chip({ chip, groupId, isDragOver, warnings, onToggle, onRemove, onWeightDelta, onReveal, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) {
  const hasMisplaced = warnings.some((w) => w.type === 'misplaced');
  const hasConflict  = warnings.some((w) => w.type === 'conflict');
  const warnClass    = hasMisplaced ? ' warn-misplaced' : hasConflict ? ' warn-conflict' : '';
  const baseTitle    = chip.enabled
    ? 'Click to disable · right-click to remove · × to remove'
    : 'Click to enable · right-click to remove';
  const title = warnings.length > 0
    ? `${warnings.map((w) => `⚠ ${w.msg}`).join(' · ')}\n${baseTitle}`
    : baseTitle;
  return (
    <span
      className={`pb-chip${chip.enabled ? '' : ' disabled'}${isDragOver ? ' drag-over' : ''}${warnClass}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onToggle}
      onContextMenu={(e) => { e.preventDefault(); onRemove(); }}
      title={title}
    >
      {warnings.length > 0 && <span className="pb-chip-warn">⚠</span>}
      <span className="pb-chip-tag">{chip.tag}</span>
      <span className={`pb-chip-weight${chip.weight === 1 ? ' empty' : ''}`}>{fmtWeight(chip.weight)}</span>
      <span className="pb-chip-actions">
        <button
          className="pb-chip-btn"
          onClick={(e) => { e.stopPropagation(); onWeightDelta(-0.1); }}
          title="Decrease weight (-0.1)"
        >−</button>
        <button
          className="pb-chip-btn"
          onClick={(e) => { e.stopPropagation(); onWeightDelta(+0.1); }}
          title="Increase weight (+0.1)"
        >+</button>
        <button
          className="pb-chip-btn"
          onClick={(e) => { e.stopPropagation(); onReveal(); }}
          title="Show in tree"
        >⌖</button>
      </span>
      <button
        className="pb-chip-x"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove"
      >×</button>
    </span>
  );
}

const STORAGE_KEY = 'promptBuilderState';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export default function PromptBuilderTab({ pendingImport, onConsumeImport } = {}) {
  const saved = loadState();
  const [chipsByGroup,   setChipsByGroup]   = useState(saved.chipsByGroup   || {});
  const [expanded,       setExpanded]       = useState(() => new Set());
  const [search,         setSearch]         = useState('');
  const [copied,         setCopied]         = useState(false);
  const [selectedModel,  setSelectedModel]  = useState(saved.selectedModel  || '');
  const [showNsfw,       setShowNsfw]       = useState(saved.showNsfw       ?? true);
  const [showAllBooru,   setShowAllBooru]   = useState(saved.showAllBooru   ?? false);
  const [defaultGroup,   setDefaultGroup]   = useState(saved.defaultGroup   || UNKNOWN_GROUP);
  const [negativePrompt, setNegativePrompt] = useState(saved.negativePrompt || '');
  const [highlightedTag, setHighlightedTag] = useState(null);
  const [drag,           setDrag]           = useState(null);
  const [dragOver,       setDragOver]       = useState(null);
  const [importOpen,     setImportOpen]     = useState(false);
  const [importText,     setImportText]     = useState('');
  const [charsOpen,      setCharsOpen]      = useState(false);
  const [charsList,      setCharsList]      = useState([]);
  const [charsLoading,   setCharsLoading]   = useState(false);
  const [charsError,     setCharsError]     = useState('');
  const [saveSeries,     setSaveSeries]     = useState('');
  const [saveName,       setSaveName]       = useState('');
  const [saveStatus,     setSaveStatus]     = useState('');
  const [fxOpen,         setFxOpen]         = useState(false);
  const [presetsOpen,    setPresetsOpen]    = useState(false);
  const [presetsList,    setPresetsList]    = useState([]);
  const [presetSaveName, setPresetSaveName] = useState('');
  const [presetStatus,   setPresetStatus]   = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        chipsByGroup, selectedModel, showNsfw, showAllBooru, defaultGroup, negativePrompt,
      }));
    } catch {}
  }, [chipsByGroup, selectedModel, showNsfw, showAllBooru, defaultGroup, negativePrompt]);

  const treeRef = useRef(null);
  const highlightTimer = useRef(null);
  const sectionRefs = useRef({});

  const addedTags = useMemo(() => {
    const s = new Set();
    for (const arr of Object.values(chipsByGroup)) for (const c of arr) s.add(c.tag);
    return s;
  }, [chipsByGroup]);

  const tagLocation = useMemo(() => {
    const m = new Map();
    for (const [g, arr] of Object.entries(chipsByGroup)) {
      for (const c of arr) m.set(c.tag, g);
    }
    return m;
  }, [chipsByGroup]);

  const chipWarnings = useMemo(() => {
    const w = new Map();
    const push = (tag, type, msg) => {
      if (!w.has(tag)) w.set(tag, []);
      w.get(tag).push({ type, msg });
    };
    // 3.1 misplaced: chip's actual group not among canonical groups (flat + fx)
    for (const [g, arr] of Object.entries(chipsByGroup)) {
      if (g === UNKNOWN_GROUP) continue;
      for (const c of arr) {
        if (!c.enabled) continue;
        const canonical = resolveGroups(c.tag);
        if (canonical.length > 0 && !canonical.includes(g)) {
          push(c.tag, 'misplaced', `Belongs in: ${canonical.join(' or ')}`);
        }
      }
    }
    // 3.2 conflicts: multiple enabled tags from same exclusive set
    const enabled = new Set();
    for (const arr of Object.values(chipsByGroup)) {
      for (const c of arr) if (c.enabled) enabled.add(c.tag);
    }
    for (const cg of CONFLICT_GROUPS) {
      const present = cg.tags.filter((t) => enabled.has(t));
      if (present.length > 1) {
        for (const tag of present) {
          const others = present.filter((t) => t !== tag);
          push(tag, 'conflict', `Conflicts with ${others.join(', ')}`);
        }
      }
    }
    return w;
  }, [chipsByGroup]);

  const suggestedNextGroup = useMemo(() => {
    const total = Object.values(chipsByGroup).reduce((s, a) => s + a.length, 0);
    if (total === 0) return null;
    for (const g of ESSENTIAL_GROUPS) {
      if (!chipsByGroup[g] || chipsByGroup[g].length === 0) return g;
    }
    return null;
  }, [chipsByGroup]);

  const warningCount = useMemo(() => {
    let n = 0;
    for (const arr of chipWarnings.values()) n += arr.length;
    return n;
  }, [chipWarnings]);

  const flashSection = useCallback((groupId) => {
    const el = sectionRefs.current[groupId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.remove('pb-section-flash');
    void el.offsetWidth;
    el.classList.add('pb-section-flash');
  }, []);

  const handleToggleNode = (p) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  const handleAddTag = useCallback((tag, group) => {
    const existingGroup = tagLocation.get(tag);
    if (existingGroup) {
      setChipsByGroup((prev) => {
        const filtered = (prev[existingGroup] || []).filter((c) => c.tag !== tag);
        const next = { ...prev };
        if (filtered.length) next[existingGroup] = filtered;
        else delete next[existingGroup];
        return next;
      });
      flashSection(existingGroup);
      return;
    }
    const g = group || defaultGroup;
    setChipsByGroup((prev) => ({
      ...prev,
      [g]: [...(prev[g] || []), NEW_CHIP(tag)],
    }));
    flashSection(g);
  }, [tagLocation, defaultGroup, flashSection]);

  const handleRemoveTag = (group, tag) => {
    setChipsByGroup((prev) => {
      const filtered = (prev[group] || []).filter((c) => c.tag !== tag);
      const next = { ...prev };
      if (filtered.length) next[group] = filtered;
      else delete next[group];
      return next;
    });
  };

  const handleToggleEnabled = (group, tag) => {
    setChipsByGroup((prev) => ({
      ...prev,
      [group]: (prev[group] || []).map((c) => c.tag === tag ? { ...c, enabled: !c.enabled } : c),
    }));
  };

  const handleWeightDelta = (group, tag, delta) => {
    setChipsByGroup((prev) => ({
      ...prev,
      [group]: (prev[group] || []).map((c) => c.tag === tag ? { ...c, weight: CLAMP_W(c.weight + delta) } : c),
    }));
  };

  const handleRevealInTree = useCallback((tag) => {
    const info = flatByTag.get(tag);
    if (!info) return;
    const parts = info.path.split('/');
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
    setHighlightedTag(tag);
    setSearch('');
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedTag(null), 2200);
    setTimeout(() => {
      const el = treeRef.current?.querySelector(`[data-tag-name="${CSS.escape(tag)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }, []);

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  useEffect(() => {
    if (!pendingImport) return;
    const parsed = parsePrompt(pendingImport.positive || '');
    setChipsByGroup(parsed);
    if (pendingImport.negative != null) setNegativePrompt(pendingImport.negative);
    onConsumeImport?.();
    const firstGroup = GROUP_ORDER.find((g) => parsed[g.id]?.length)?.id || (parsed[UNKNOWN_GROUP]?.length ? UNKNOWN_GROUP : null);
    if (firstGroup) setTimeout(() => flashSection(firstGroup), 60);
  }, [pendingImport]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (fxOpen)         { setFxOpen(false);     return; }
      if (presetsOpen)    { setPresetsOpen(false);return; }
      if (charsOpen)      { setCharsOpen(false);  return; }
      if (importOpen)     { setImportOpen(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fxOpen, presetsOpen, charsOpen, importOpen]);

  const currentModelCat = MODEL_CATEGORY[selectedModel] || null;
  const isFxCompatible  = (tag) => !currentModelCat || tag.models.includes('all') || tag.models.includes(currentModelCat);

  const handleDragStart = (group, idx) => (e) => {
    setDrag({ group, fromIndex: idx });
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (group, idx) => (e) => {
    if (!drag || drag.group !== group) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ group, idx });
  };
  const handleDragLeave = () => setDragOver(null);
  const handleDrop = (group, idx) => (e) => {
    e.preventDefault();
    if (!drag || drag.group !== group || drag.fromIndex === idx) {
      setDrag(null); setDragOver(null); return;
    }
    setChipsByGroup((prev) => {
      const arr = [...(prev[group] || [])];
      const [moved] = arr.splice(drag.fromIndex, 1);
      const insertAt = drag.fromIndex < idx ? idx : idx;
      arr.splice(insertAt, 0, moved);
      return { ...prev, [group]: arr };
    });
    setDrag(null); setDragOver(null);
  };
  const handleDragEnd = () => { setDrag(null); setDragOver(null); };

  const handleModelChange = (model) => {
    setSelectedModel(model);
    if (!model) return;
    const q = qualityData[model];
    setChipsByGroup((prev) => ({
      ...prev,
      'quality-before': q.before.map(NEW_CHIP),
      'quality-after':  q.after.map(NEW_CHIP),
    }));
    setNegativePrompt(q.negative);
    setTimeout(() => flashSection('quality-before'), 30);
  };

  const finalPrompt = useMemo(() => buildPrompt(chipsByGroup), [chipsByGroup]);
  const totalChips  = useMemo(
    () => Object.values(chipsByGroup).reduce((s, a) => s + a.filter((c) => c.enabled).length, 0),
    [chipsByGroup]
  );

  const handleCopy = async () => {
    if (!finalPrompt) return;
    try {
      await navigator.clipboard.writeText(finalPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleClearAll = () => {
    const hasContent = Object.keys(chipsByGroup).length > 0 || selectedModel || negativePrompt;
    if (!hasContent) return;
    if (!window.confirm('Clear all tags, model and negative prompt?')) return;
    setChipsByGroup({});
    setSelectedModel('');
    setNegativePrompt('');
  };

  const handleApplyImport = () => {
    const text = importText.trim();
    if (!text) return;
    const parsed = parsePrompt(text);
    setChipsByGroup(parsed);
    setImportText('');
    setImportOpen(false);
    const firstGroup = GROUP_ORDER.find((g) => parsed[g.id]?.length)?.id || (parsed[UNKNOWN_GROUP]?.length ? UNKNOWN_GROUP : null);
    if (firstGroup) setTimeout(() => flashSection(firstGroup), 30);
  };

  const handlePasteImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(text);
    } catch {}
  };

  const refreshCharacters = useCallback(async () => {
    if (!window.api?.listCharacters) {
      setCharsError('Characters require Electron mode');
      return;
    }
    setCharsLoading(true);
    setCharsError('');
    try {
      const result = await window.api.listCharacters();
      setCharsList(result?.items || []);
    } catch (e) {
      setCharsError(String(e?.message || e));
    }
    setCharsLoading(false);
  }, []);

  const handleOpenCharacters = () => {
    setCharsOpen(true);
    setSaveStatus('');
    refreshCharacters();
  };

  const handleLoadChar = async (item) => {
    if (!window.api?.readCharacter) return;
    setCharsError('');
    const md = await window.api.readCharacter(item.path);
    if (!md) { setCharsError('Could not read file'); return; }
    const final = extractFinalPromptFromMd(md);
    if (!final) { setCharsError('Could not find ## Final Prompt section'); return; }
    const parsed = parsePrompt(final);
    setChipsByGroup(parsed);
    setCharsOpen(false);
    const firstGroup = GROUP_ORDER.find((g) => parsed[g.id]?.length)?.id || (parsed[UNKNOWN_GROUP]?.length ? UNKNOWN_GROUP : null);
    if (firstGroup) setTimeout(() => flashSection(firstGroup), 30);
  };

  const refreshPresets = useCallback(async () => {
    if (!window.api?.listPresets) { setPresetStatus('Presets require Electron mode'); return; }
    try {
      const list = await window.api.listPresets();
      setPresetsList(list || []);
    } catch (e) { setPresetStatus(String(e?.message || e)); }
  }, []);

  const handleOpenPresets = () => {
    setPresetsOpen(true);
    setPresetStatus('');
    refreshPresets();
  };

  const handleLoadPreset = async (name) => {
    if (!window.api?.readPreset) return;
    const data = await window.api.readPreset(name);
    if (!data) { setPresetStatus('✗ Could not read preset'); return; }
    setChipsByGroup(data.chipsByGroup || {});
    setSelectedModel(data.selectedModel || '');
    setNegativePrompt(data.negativePrompt || '');
    setPresetsOpen(false);
  };

  const handleSavePreset = async () => {
    if (!window.api?.savePreset) { setPresetStatus('Presets require Electron mode'); return; }
    const name = presetSaveName.trim();
    if (!name) { setPresetStatus('Name required'); return; }
    const exists = presetsList.includes(name);
    if (exists && !window.confirm(`Preset "${name}" exists. Overwrite?`)) return;
    const data = {
      name,
      selectedModel,
      chipsByGroup,
      negativePrompt,
      savedAt: new Date().toISOString(),
    };
    const result = await window.api.savePreset({ name, data });
    if (result?.ok) {
      setPresetStatus(exists ? `✓ Overwritten "${name}"` : `✓ Saved "${name}"`);
      setPresetSaveName('');
      refreshPresets();
    } else {
      setPresetStatus(`✗ ${result?.error || 'save failed'}`);
    }
  };

  const handleDeletePreset = async (name) => {
    if (!window.api?.deletePreset) return;
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    const result = await window.api.deletePreset(name);
    if (result?.ok) {
      setPresetStatus(`✓ Deleted "${name}"`);
      refreshPresets();
    } else {
      setPresetStatus(`✗ ${result?.error || 'delete failed'}`);
    }
  };

  const handleSaveChar = async () => {
    if (!window.api?.saveCharacter) {
      setSaveStatus('Save requires Electron mode');
      return;
    }
    if (!saveSeries.trim() || !saveName.trim()) {
      setSaveStatus('Series and name required');
      return;
    }
    if (!finalPrompt) {
      setSaveStatus('Nothing to save — add some tags first');
      return;
    }
    const series = saveSeries.trim().toLowerCase().replace(/\s+/g, '-');
    const name   = saveName.trim().toLowerCase();
    const exists = charsList.some((c) => c.series === series && c.name === name);
    if (exists && !window.confirm(`"${series}/${name}.md" already exists. Overwrite?`)) return;
    const content = generateCharacterMd(name, chipsByGroup, finalPrompt, allBooruData);
    const result = await window.api.saveCharacter({ series, name, content });
    if (result?.ok) {
      setSaveStatus(exists ? '✓ Overwritten' : '✓ Saved');
      setSaveSeries('');
      setSaveName('');
      refreshCharacters();
    } else {
      setSaveStatus(`✗ ${result?.error || 'save failed'}`);
    }
  };

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    if (showAllBooru) {
      const out = [];
      for (const [tag, count] of Object.entries(allBooruData)) {
        if (!tag.toLowerCase().includes(q)) continue;
        const info = flatByTag.get(tag);
        if (info && info.nsfw && !showNsfw) continue;
        const groups = resolveGroups(tag);
        out.push({
          tag,
          count,
          group: groups[0] || null,
          nsfw: info?.nsfw || false,
          description: info?.description || '',
          path: info?.path || '',
        });
        if (out.length >= 200) break;
      }
      return out.sort((a, b) => b.count - a.count).slice(0, 50);
    }
    return flatData
      .filter((t) => (showNsfw || !t.nsfw) && t.tag.toLowerCase().includes(q))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [search, showAllBooru, showNsfw]);

  return (
    <div className="pb-tab">
      {/* LEFT — toolbar + search + tree/results */}
      <div className="pb-pane pb-pane-left">
        <div className="pb-toolbar">
          <label className="pb-toggle">
            <input type="checkbox" checked={showNsfw} onChange={(e) => setShowNsfw(e.target.checked)} />
            <span>NSFW</span>
          </label>
          <label className="pb-toggle">
            <input type="checkbox" checked={showAllBooru} onChange={(e) => setShowAllBooru(e.target.checked)} />
            <span>All booru</span>
          </label>
        </div>
        <div className="pb-search">
          <input
            type="text"
            placeholder={showAllBooru ? 'Search all booru tags…' : 'Search curated tags…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className="pb-search-clear" onClick={() => setSearch('')} title="Clear">×</button>
          )}
        </div>
        {showAllBooru && search.length >= 2 && (
          <div className="pb-default-group">
            <span className="pb-default-group-label">Unknown tags →</span>
            <select value={defaultGroup} onChange={(e) => setDefaultGroup(e.target.value)}>
              <option value={UNKNOWN_GROUP}>Unknown (manual sort)</option>
              {GROUP_ORDER.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>
        )}
        {searchResults.length > 0 ? (
          <div className="pb-search-results">
            {searchResults.map((t, i) => (
              <button
                key={`${t.tag}-${i}`}
                className={`pb-search-result${addedTags.has(t.tag) ? ' added' : ''}`}
                onClick={() => handleAddTag(t.tag, t.group || defaultGroup)}
                title={t.group ? (t.description || t.tag) : `Not in curated library — will go to "${defaultGroup === UNKNOWN_GROUP ? 'Unknown' : defaultGroup}"\n${t.description || ''}`.trim()}
              >
                <span className="pb-tag-name">{t.tag}</span>
                <span className="pb-search-meta">
                  {t.group ? (
                    <span className="pb-search-group">{t.group}</span>
                  ) : (
                    <span className="pb-search-group pb-search-group-unknown">
                      ? → {defaultGroup === UNKNOWN_GROUP ? 'unknown' : defaultGroup}
                    </span>
                  )}
                  {t.count > 0 && <span className="pb-tag-count">{formatCount(t.count)}</span>}
                  {t.nsfw && <span className="pb-search-nsfw">nsfw</span>}
                </span>
              </button>
            ))}
          </div>
        ) : search.trim().length >= 2 ? (
          <div className="pb-search-empty">No tags match "{search}"</div>
        ) : (
          <div className="pb-tree" ref={treeRef}>
            {Object.entries(treeData).map(([k, v]) => (
              <TreeNode
                key={k}
                name={k}
                node={v}
                depth={0}
                expanded={expanded}
                onToggle={handleToggleNode}
                onAddTag={handleAddTag}
                addedTags={addedTags}
                highlightedTag={highlightedTag}
                showNsfw={showNsfw}
                path={k}
              />
            ))}
          </div>
        )}
      </div>

      {/* CENTER — model selector + 15 sections */}
      <div className="pb-pane pb-pane-center">
        <div className="pb-model-row">
          <label>Model:</label>
          <select value={selectedModel} onChange={(e) => handleModelChange(e.target.value)}>
            <option value="">— none —</option>
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {selectedModel && (
            <span className="pb-model-hint">
              quality-before/after & negative prompt auto-applied
            </span>
          )}
        </div>
        {GROUP_ORDER.map(({ id, label }) => {
          const chips = chipsByGroup[id] || [];
          const enabledCount = chips.filter((c) => c.enabled).length;
          const isSuggested  = id === suggestedNextGroup;
          return (
            <div
              key={id}
              className={`pb-section${isSuggested ? ' suggested' : ''}`}
              ref={(el) => { if (el) sectionRefs.current[id] = el; }}
            >
              <div className="pb-section-header">
                <span className="pb-section-label">
                  {isSuggested && <span className="pb-suggested-mark" title="Suggested next">★</span>}
                  {label}
                </span>
                <span className="pb-section-count">
                  {chips.length > 0 && (enabledCount === chips.length ? chips.length : `${enabledCount}/${chips.length}`)}
                </span>
              </div>
              <div
                className="pb-chips"
                onDragOver={chips.length === 0 ? handleDragOver(id, 0) : undefined}
                onDrop={chips.length === 0 ? handleDrop(id, 0) : undefined}
              >
                {chips.length === 0 ? (
                  <span className="pb-chips-empty">—</span>
                ) : (
                  chips.map((chip, idx) => (
                    <Chip
                      key={chip.tag}
                      chip={chip}
                      groupId={id}
                      isDragOver={dragOver?.group === id && dragOver?.idx === idx}
                      warnings={chipWarnings.get(chip.tag) || []}
                      onToggle={() => handleToggleEnabled(id, chip.tag)}
                      onRemove={() => handleRemoveTag(id, chip.tag)}
                      onWeightDelta={(d) => handleWeightDelta(id, chip.tag, d)}
                      onReveal={() => handleRevealInTree(chip.tag)}
                      onDragStart={handleDragStart(id, idx)}
                      onDragOver={handleDragOver(id, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop(id, idx)}
                      onDragEnd={handleDragEnd}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
        {chipsByGroup[UNKNOWN_GROUP]?.length > 0 && (
          <div
            className="pb-section pb-section-unknown"
            ref={(el) => { if (el) sectionRefs.current[UNKNOWN_GROUP] = el; }}
          >
            <div className="pb-section-header">
              <span className="pb-section-label">
                <span className="pb-unknown-mark" title="Tags not in curated library">?</span>
                Unknown / Unmatched
              </span>
              <span className="pb-section-count">
                {chipsByGroup[UNKNOWN_GROUP].filter((c) => c.enabled).length}/{chipsByGroup[UNKNOWN_GROUP].length}
              </span>
            </div>
            <div className="pb-chips">
              {chipsByGroup[UNKNOWN_GROUP].map((chip, idx) => (
                <Chip
                  key={chip.tag}
                  chip={chip}
                  groupId={UNKNOWN_GROUP}
                  isDragOver={dragOver?.group === UNKNOWN_GROUP && dragOver?.idx === idx}
                  warnings={chipWarnings.get(chip.tag) || []}
                  onToggle={() => handleToggleEnabled(UNKNOWN_GROUP, chip.tag)}
                  onRemove={() => handleRemoveTag(UNKNOWN_GROUP, chip.tag)}
                  onWeightDelta={(d) => handleWeightDelta(UNKNOWN_GROUP, chip.tag, d)}
                  onReveal={() => handleRevealInTree(chip.tag)}
                  onDragStart={handleDragStart(UNKNOWN_GROUP, idx)}
                  onDragOver={handleDragOver(UNKNOWN_GROUP, idx)}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop(UNKNOWN_GROUP, idx)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — preview + negative */}
      <div className="pb-pane pb-pane-right">
        <div className="pb-preview-header">
          <span>Final Prompt</span>
          <span className="pb-preview-count">
            {totalChips} tag{totalChips !== 1 ? 's' : ''}
            {warningCount > 0 && (
              <span className="pb-warning-badge" title={`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}>
                {' · ⚠ '}{warningCount}
              </span>
            )}
          </span>
        </div>
        <textarea
          className="pb-preview-textarea"
          value={finalPrompt}
          readOnly
          placeholder="Empty — click tags in the tree to add them."
          spellCheck={false}
        />
        <div className="pb-preview-actions">
          <button onClick={handleCopy} disabled={!finalPrompt}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => setImportOpen((v) => !v)}
            className={importOpen ? '' : 'pb-btn-secondary'}
          >
            Import
          </button>
          <button onClick={handleOpenCharacters} className="pb-btn-secondary">
            Characters
          </button>
          <button onClick={() => setFxOpen(true)} className="pb-btn-secondary">
            Scene FX
          </button>
          <button onClick={handleOpenPresets} className="pb-btn-secondary">
            Presets
          </button>
          <button
            onClick={handleClearAll}
            disabled={!Object.keys(chipsByGroup).length && !selectedModel && !negativePrompt}
            className="pb-btn-secondary"
          >
            Clear all
          </button>
        </div>
        {importOpen && (
          <div className="pb-import">
            <div className="pb-import-header">
              <span>Paste prompt to apply</span>
              <button className="pb-import-paste" onClick={handlePasteImport} title="Paste from clipboard">📋 Paste</button>
            </div>
            <textarea
              className="pb-import-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="masterpiece, best quality, 1girl, solo, blue eyes, ..."
              spellCheck={false}
              autoFocus
            />
            <div className="pb-import-actions">
              <button onClick={handleApplyImport} disabled={!importText.trim()}>Apply (replaces all)</button>
              <button
                onClick={() => { setImportOpen(false); setImportText(''); }}
                className="pb-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="pb-negative">
          <div className="pb-negative-header">
            <span>Negative prompt</span>
            {negativePrompt && <span className="pb-negative-hint">{negativePrompt.length} chars</span>}
          </div>
          <textarea
            className="pb-negative-textarea"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="Pick a model to auto-fill, or type manually."
            spellCheck={false}
          />
        </div>
      </div>

      {presetsOpen && (
        <div className="pb-modal-backdrop" onClick={() => setPresetsOpen(false)}>
          <div className="pb-modal pb-modal-presets" onClick={(e) => e.stopPropagation()}>
            <div className="pb-modal-header">
              <span>Presets</span>
              <button className="pb-modal-close" onClick={() => setPresetsOpen(false)}>×</button>
            </div>
            <div className="pb-modal-body">
              <div className="pb-chars-list">
                <div className="pb-chars-list-header">
                  <span>Load existing</span>
                  <button className="pb-import-paste" onClick={refreshPresets} title="Refresh">↻</button>
                </div>
                {presetsList.length === 0 ? (
                  <div className="pb-chars-empty">No presets saved</div>
                ) : (
                  <div className="pb-chars-items">
                    {presetsList.map((name) => (
                      <div key={name} className="pb-preset-item">
                        <button
                          className="pb-preset-load"
                          onClick={() => handleLoadPreset(name)}
                          title="Load this preset"
                        >{name}</button>
                        <button
                          className="pb-preset-delete"
                          onClick={() => handleDeletePreset(name)}
                          title="Delete preset"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pb-chars-save">
                <div className="pb-chars-list-header">Save current as preset</div>
                <input
                  type="text"
                  placeholder="Preset name"
                  value={presetSaveName}
                  onChange={(e) => setPresetSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                  spellCheck={false}
                />
                <button
                  onClick={handleSavePreset}
                  disabled={!presetSaveName.trim() || !finalPrompt}
                >
                  Save
                </button>
                {presetStatus && <div className="pb-chars-status">{presetStatus}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {fxOpen && (
        <div className="pb-modal-backdrop" onClick={() => setFxOpen(false)}>
          <div className="pb-modal pb-modal-fx" onClick={(e) => e.stopPropagation()}>
            <div className="pb-modal-header">
              <span>
                Scene / Effect Picker
                {currentModelCat && (
                  <span className="pb-fx-model-hint"> · filtering for {currentModelCat}</span>
                )}
              </span>
              <button className="pb-modal-close" onClick={() => setFxOpen(false)}>×</button>
            </div>
            <div className="pb-modal-body pb-fx-body">
              {sceneEffectData.categories.map((cat) => (
                <div key={cat.name} className="pb-fx-category">
                  <div className="pb-fx-category-name">{cat.name}</div>
                  <div className="pb-fx-tags">
                    {cat.tags.map((t) => {
                      const added  = addedTags.has(t.tag);
                      const compat = isFxCompatible(t);
                      return (
                        <button
                          key={t.tag}
                          className={`pb-fx-tag${added ? ' added' : ''}${!compat ? ' incompat' : ''}`}
                          onClick={() => handleAddTag(t.tag, t.group)}
                          title={`${t.notes}\n→ goes in: ${t.group}${!compat ? '\n⚠ Not recommended for ' + currentModelCat : ''}`}
                        >
                          <span className={`pb-fx-pos pb-fx-pos-${t.position}`}>{t.position}</span>
                          <span className="pb-fx-tag-name">{t.tag}</span>
                          <span className="pb-fx-models">
                            {t.models.map((m) => <span key={m} className={`pb-fx-model pb-fx-model-${m}`}>{m}</span>)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {charsOpen && (
        <div className="pb-modal-backdrop" onClick={() => setCharsOpen(false)}>
          <div className="pb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pb-modal-header">
              <span>Characters</span>
              <button className="pb-modal-close" onClick={() => setCharsOpen(false)}>×</button>
            </div>
            <div className="pb-modal-body">
              <div className="pb-chars-list">
                <div className="pb-chars-list-header">
                  <span>Load existing</span>
                  <button className="pb-import-paste" onClick={refreshCharacters} title="Refresh">↻</button>
                </div>
                {charsError && <div className="pb-chars-error">{charsError}</div>}
                {charsLoading ? (
                  <div className="pb-chars-loading">Loading…</div>
                ) : charsList.length === 0 ? (
                  <div className="pb-chars-empty">No characters found</div>
                ) : (
                  <div className="pb-chars-items">
                    {Object.entries(charsList.reduce((acc, c) => {
                      (acc[c.series] = acc[c.series] || []).push(c);
                      return acc;
                    }, {})).map(([series, items]) => (
                      <div key={series} className="pb-chars-series">
                        <div className="pb-chars-series-name">{series}</div>
                        {items.map((it) => (
                          <button
                            key={it.path}
                            className={`pb-chars-item${it.multi ? ' multi' : ''}`}
                            onClick={() => handleLoadChar(it)}
                            title={it.path}
                          >
                            <span>{it.name}</span>
                            {it.multi && <span className="pb-chars-multi-badge">multi</span>}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pb-chars-save">
                <div className="pb-chars-list-header">Save current as character</div>
                <input
                  type="text"
                  placeholder="Series (e.g. one-punch-man)"
                  value={saveSeries}
                  onChange={(e) => setSaveSeries(e.target.value)}
                  spellCheck={false}
                />
                <input
                  type="text"
                  placeholder="Name (e.g. fubuki)"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  spellCheck={false}
                />
                <button
                  onClick={handleSaveChar}
                  disabled={!saveSeries.trim() || !saveName.trim() || !finalPrompt}
                >
                  Save
                </button>
                {saveStatus && <div className="pb-chars-status">{saveStatus}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
