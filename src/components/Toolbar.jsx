const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const AspectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M8 5v14M16 5v14" strokeWidth="1.5" strokeOpacity="0.5" />
  </svg>
);

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ResIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M7 10v4M12 10v4M17 10v4" strokeWidth="2" />
  </svg>
);

const GroupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M3 12h18M3 18h18" />
    <circle cx="7" cy="6" r="1.5" fill="currentColor" />
    <circle cx="7" cy="12" r="1.5" fill="currentColor" />
    <circle cx="7" cy="18" r="1.5" fill="currentColor" />
  </svg>
);

const CompareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="8" height="18" rx="1.5" />
    <rect x="14" y="3" width="8" height="18" rx="1.5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const UpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

export default function Toolbar({ folder, currentPath, count, onOpenFolder, onRefresh, onNavigateUp, viewOptions, onToggleOption, selectedCount, onCompare, onClearSelection, activeTab, onTabChange }) {
  const inSubfolder = currentPath && folder && currentPath !== folder;
  return (
    <div className="toolbar">
      <h1>Image Viewer</h1>
      <div className="toolbar-tabs">
        <button
          className={`tab-btn${activeTab === 'images' ? ' active' : ''}`}
          onClick={() => onTabChange('images')}
        >Images</button>
        <button
          className={`tab-btn${activeTab === 'comfyui' ? ' active' : ''}`}
          onClick={() => onTabChange('comfyui')}
        >ComfyUI</button>
      </div>
      <div className="toolbar-sep" />
      {activeTab === 'images' && (
        <>
          {inSubfolder && (
            <button className="btn-icon" onClick={onNavigateUp} title="Go to parent folder">
              <UpIcon />
            </button>
          )}
          <span className="folder-path">{currentPath || folder || 'No folder selected'}</span>
          {count > 0 && (
            <span className="count">{count} image{count !== 1 ? 's' : ''}</span>
          )}

          <div className="toolbar-sep" />

          <button
            className={`btn-icon${viewOptions.originalAspect ? ' active' : ''}`}
            onClick={() => onToggleOption('originalAspect')}
            title="Original aspect ratio"
          ><AspectIcon /></button>

          <button
            className={`btn-icon${viewOptions.largeGrid ? ' active' : ''}`}
            onClick={() => onToggleOption('largeGrid')}
            title="Large grid"
          ><GridIcon /></button>

          <button
            className={`btn-icon${viewOptions.showResolution ? ' active' : ''}`}
            onClick={() => onToggleOption('showResolution')}
            title="Show resolution"
          ><ResIcon /></button>

          <button
            className={`btn-icon${viewOptions.groupBySeed ? ' active' : ''}`}
            onClick={() => onToggleOption('groupBySeed')}
            title="Group by seed & prompt"
          ><GroupIcon /></button>

          <div className="toolbar-sep" />

          {selectedCount > 0 && (
            <>
              <button className="btn-icon" onClick={onClearSelection} title="Clear selection" style={{ fontSize: 13 }}>✕</button>
              {selectedCount >= 2 && (
                <button onClick={onCompare} title="Compare selected images" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CompareIcon /> Compare ({selectedCount})
                </button>
              )}
              <div className="toolbar-sep" />
            </>
          )}

          {folder && (
            <button className="btn-icon" onClick={onRefresh} title="Refresh">
              <RefreshIcon />
            </button>
          )}
          <button onClick={onOpenFolder}>Open Folder</button>
        </>
      )}
    </div>
  );
}
