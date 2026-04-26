import { useState, useRef, useCallback, useEffect } from 'react';

const toFileUrl = (filePath) => 'file:///' + filePath.replace(/\\/g, '/');

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);

function groupKey(meta) {
  if (!meta) return null;
  const seed = meta.seed != null ? String(meta.seed) : '';
  const prompt = meta.positivePrompt ? meta.positivePrompt.trim() : '';
  return seed || prompt ? `${seed}||${prompt}` : null;
}

function groupLabel(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.seed != null) parts.push(`Seed ${meta.seed}`);
  if (meta.positivePrompt) {
    const p = meta.positivePrompt.trim();
    parts.push(p.length > 72 ? p.slice(0, 72) + '…' : p);
  }
  return parts.join(' · ') || null;
}

const FolderIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);

export default function Grid({ images, subfolders = [], onSelect, onDelete, onNavigateInto, imageMeta, viewOptions, selectedPaths, onToggleSelect, isFullscreen }) {
  const [dims, setDims] = useState({});
  const scrollRef = useRef(null);
  const [scrollInfo, setScrollInfo] = useState({ show: false, top: 0, thumbH: 30 });

  const updateScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setScrollInfo({ show: false, top: 0, thumbH: 30 });
      return;
    }
    const ratio = clientHeight / scrollHeight;
    const thumbH = Math.max(30, ratio * clientHeight);
    const maxThumbTop = clientHeight - thumbH;
    const maxScrollTop = scrollHeight - clientHeight;
    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
    setScrollInfo({ show: true, top, thumbH });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScroll();
    const ro = new ResizeObserver(updateScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScroll]);

  const onThumbMouseDown = useCallback((e) => {
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startScrollTop = el.scrollTop;
    const { scrollHeight, clientHeight } = el;
    const ratio = clientHeight / scrollHeight;
    const thumbH = Math.max(30, ratio * clientHeight);
    const maxThumbTop = clientHeight - thumbH;
    const maxScrollTop = scrollHeight - clientHeight;
    const scale = maxScrollTop / Math.max(1, maxThumbTop);

    const onMove = (ev) => {
      const delta = ev.clientY - startY;
      el.scrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTop + delta * scale));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const onTrackClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  }, []);

  const thumbClass = `thumb${viewOptions.originalAspect ? ' thumb-natural' : ''}`;
  const gridClass = `grid${viewOptions.largeGrid ? ' grid-large' : ''}`;

  const renderThumb = (img) => {
    const d = dims[img.filePath];
    const isSelected = selectedPaths.includes(img.filePath);
    return (
      <div key={img.filePath} className="thumb-wrap" onClick={() => onSelect(img.filePath)}>
        <div className={`${thumbClass}${isSelected ? ' thumb-selected' : ''}`}>
          <img
            src={toFileUrl(img.filePath)}
            alt={img.name}
            loading="lazy"
            onLoad={(e) => setDims(prev => ({
              ...prev,
              [img.filePath]: { w: e.target.naturalWidth, h: e.target.naturalHeight },
            }))}
          />
          <button
            className={`thumb-select${isSelected ? ' selected' : ''}`}
            title="Select for comparison"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(img.filePath); }}
          >
            {isSelected ? '✓' : ''}
          </button>
          <button
            className="thumb-delete"
            title="Move to Trash"
            onClick={(e) => { e.stopPropagation(); onDelete(img.filePath); }}
          >
            <TrashIcon />
          </button>
        </div>
        {viewOptions.showResolution && d && (
          <div className="thumb-resolution">{d.w} × {d.h}</div>
        )}
      </div>
    );
  };

  const renderFolders = () => {
    if (!subfolders.length) return null;
    return (
      <div className="folder-row">
        {subfolders.map(sf => (
          <div key={sf.folderPath} className="folder-card" onClick={() => onNavigateInto(sf.folderPath)} title={sf.name}>
            <FolderIcon />
            <span className="folder-card-name">{sf.name}</span>
          </div>
        ))}
      </div>
    );
  };

  const sortedImages = [...images].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

  let innerContent;
  if (viewOptions.groupBySeed) {
    const groupMap = new Map();
    sortedImages.forEach(img => {
      const meta = imageMeta[img.filePath];
      const key = groupKey(meta) ?? '__other__';
      if (!groupMap.has(key)) {
        groupMap.set(key, { label: groupLabel(meta), items: [], newestCreated: 0 });
      }
      const g = groupMap.get(key);
      g.items.push(img);
      if ((img.created ?? 0) > g.newestCreated) g.newestCreated = img.created ?? 0;
    });

    const ordered = [...groupMap.entries()].sort(([keyA, a], [keyB, b]) => {
      if (keyA === '__other__') return 1;
      if (keyB === '__other__') return -1;
      return b.newestCreated - a.newestCreated;
    });

    ordered.forEach(([, g]) => g.items.sort((a, b) => (a.created ?? 0) - (b.created ?? 0)));

    innerContent = (
      <>
        {renderFolders()}
        {ordered.map(([key, group]) => (
          <div key={key} className="grid-group">
            <div className="grid-group-header">{group.label ?? 'Other'}</div>
            <div className={gridClass}>
              {group.items.map(img => renderThumb(img))}
            </div>
          </div>
        ))}
      </>
    );
  } else {
    innerContent = (
      <>
        {renderFolders()}
        <div className={gridClass}>
          {sortedImages.map(img => renderThumb(img))}
        </div>
      </>
    );
  }

  return (
    <div className="grid-wrapper">
      <div
        className="grid-container"
        ref={scrollRef}
        onScroll={updateScroll}
        style={isFullscreen ? { padding: 0 } : undefined}
      >
        {innerContent}
      </div>
      {scrollInfo.show && (
        <div className="custom-scrollbar" onClick={onTrackClick}>
          <div
            className="custom-scrollbar-thumb"
            style={{ top: scrollInfo.top, height: scrollInfo.thumbH }}
            onMouseDown={onThumbMouseDown}
          />
        </div>
      )}
    </div>
  );
}
