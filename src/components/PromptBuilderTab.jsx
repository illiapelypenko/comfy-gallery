import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import treeData from '@shared/group_tags.json';
import flatData from '@shared/group_tags_flat.json';
import allBooruData from '@shared/all_booru_tags.json';
import qualityData from '@shared/quality_tags.json';

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

function buildPrompt(chipsByGroup) {
  const parts = [];
  for (const { id } of GROUP_ORDER) {
    for (const chip of chipsByGroup[id] || []) {
      if (chip.enabled) parts.push(formatChip(chip));
    }
  }
  return parts.join(', ');
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

function Chip({ chip, groupId, isDragOver, onToggle, onRemove, onWeightDelta, onReveal, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) {
  return (
    <span
      className={`pb-chip${chip.enabled ? '' : ' disabled'}${isDragOver ? ' drag-over' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onToggle}
      onContextMenu={(e) => { e.preventDefault(); onRemove(); }}
      title={chip.enabled ? 'Click to disable · right-click to remove · × to remove' : 'Click to enable · right-click to remove'}
    >
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

export default function PromptBuilderTab() {
  const saved = loadState();
  const [chipsByGroup,   setChipsByGroup]   = useState(saved.chipsByGroup   || {});
  const [expanded,       setExpanded]       = useState(() => new Set());
  const [search,         setSearch]         = useState('');
  const [copied,         setCopied]         = useState(false);
  const [selectedModel,  setSelectedModel]  = useState(saved.selectedModel  || '');
  const [showNsfw,       setShowNsfw]       = useState(saved.showNsfw       || false);
  const [showAllBooru,   setShowAllBooru]   = useState(saved.showAllBooru   || false);
  const [defaultGroup,   setDefaultGroup]   = useState(saved.defaultGroup   || 'appearance');
  const [negativePrompt, setNegativePrompt] = useState(saved.negativePrompt || '');
  const [highlightedTag, setHighlightedTag] = useState(null);
  const [drag,           setDrag]           = useState(null);
  const [dragOver,       setDragOver]       = useState(null);

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

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    if (showAllBooru) {
      const out = [];
      for (const [tag, count] of Object.entries(allBooruData)) {
        if (!tag.toLowerCase().includes(q)) continue;
        const info = flatByTag.get(tag);
        if (info && info.nsfw && !showNsfw) continue;
        out.push({
          tag,
          count,
          group: info?.group || null,
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
            <span className="pb-default-group-label">Default group:</span>
            <select value={defaultGroup} onChange={(e) => setDefaultGroup(e.target.value)}>
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
                onClick={() => handleAddTag(t.tag, t.group)}
                title={t.description || t.tag}
              >
                <span className="pb-tag-name">{t.tag}</span>
                <span className="pb-search-meta">
                  {t.group ? (
                    <span className="pb-search-group">{t.group}</span>
                  ) : (
                    <span className="pb-search-group pb-search-group-unknown">→ {defaultGroup}</span>
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
          return (
            <div
              key={id}
              className="pb-section"
              ref={(el) => { if (el) sectionRefs.current[id] = el; }}
            >
              <div className="pb-section-header">
                <span className="pb-section-label">{label}</span>
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
      </div>

      {/* RIGHT — preview + negative */}
      <div className="pb-pane pb-pane-right">
        <div className="pb-preview-header">
          <span>Final Prompt</span>
          <span className="pb-preview-count">{totalChips} tag{totalChips !== 1 ? 's' : ''}</span>
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
            onClick={handleClearAll}
            disabled={!Object.keys(chipsByGroup).length && !selectedModel && !negativePrompt}
            className="pb-btn-secondary"
          >
            Clear all
          </button>
        </div>
        <details className="pb-negative">
          <summary>
            Negative prompt
            {negativePrompt && <span className="pb-negative-hint"> · {negativePrompt.length} chars</span>}
          </summary>
          <textarea
            className="pb-negative-textarea"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="Pick a model to auto-fill, or type manually."
            spellCheck={false}
            rows={6}
          />
        </details>
      </div>
    </div>
  );
}
