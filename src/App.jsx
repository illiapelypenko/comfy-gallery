import { useState, useEffect, useCallback, useMemo } from 'react';
import Toolbar from './components/Toolbar';
import Grid from './components/Grid';
import Lightbox from './components/Lightbox';
import ComparePanel from './components/ComparePanel';
import ComfyUITab from './components/ComfyUITab';
import PromptBuilderTab from './components/PromptBuilderTab';

// Computes the flat ordered image list that matches what the grid displays.
// Flat: newest first. Grouped: newest group first, within each group oldest first.
function computeNavImages(images, imageMeta, groupBySeed) {
  const sorted = [...images].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  if (!groupBySeed) return sorted;

  const groupMap = new Map();
  sorted.forEach(img => {
    const meta = imageMeta[img.filePath];
    const seed   = meta?.seed != null ? String(meta.seed) : '';
    const prompt = meta?.positivePrompt?.trim() ?? '';
    const key    = (seed || prompt) ? `${seed}||${prompt}` : '__other__';
    if (!groupMap.has(key)) groupMap.set(key, { items: [], newestCreated: 0 });
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

  return ordered.flatMap(([, g]) => g.items);
}

export default function App() {
  const [images, setImages] = useState([]);
  const [subfolders, setSubfolders] = useState([]);
  const [folder, setFolder] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [imageMeta, setImageMeta] = useState({});
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('images');
  const [pendingPromptImport, setPendingPromptImport] = useState(null);

  const handleEditInBuilder = useCallback(({ positive, negative }) => {
    setPendingPromptImport({ positive, negative });
    setActiveTab('builder');
    setLightboxIndex(null);
    setShowCompare(false);
  }, []);
  const [viewOptions, setViewOptions] = useState(() => {
    const defaults = { originalAspect: false, largeGrid: false, showResolution: true, groupBySeed: false };
    try {
      const saved = JSON.parse(localStorage.getItem('viewOptions'));
      if (saved && typeof saved === 'object') return { ...defaults, ...saved };
    } catch {}
    return defaults;
  });

  // The ordered image list matching the current grid display order.
  const navImages = useMemo(
    () => computeNavImages(images, imageMeta, viewOptions.groupBySeed),
    [images, imageMeta, viewOptions.groupBySeed]
  );

  const loadPath = useCallback(async (dirPath) => {
    const result = await window.api.readFolder(dirPath);
    setImages(result.images);
    setSubfolders(result.subfolders);
    setCurrentPath(dirPath);
    setImageMeta({});
    result.images.forEach(img => {
      if (img.filePath.toLowerCase().endsWith('.png')) {
        window.api.getPngMeta(img.filePath)
          .then(meta => { if (meta) setImageMeta(prev => ({ ...prev, [img.filePath]: meta })); })
          .catch(() => {});
      }
    });
  }, []);

  const openFolder = async () => {
    const dirPath = await window.api.openFolder();
    if (!dirPath) return;
    setFolder(dirPath);
    await loadPath(dirPath);
    setLightboxIndex(null);
  };

  const navigateInto = useCallback(async (subPath) => {
    await loadPath(subPath);
    setLightboxIndex(null);
    setSelectedPaths([]);
  }, [loadPath]);

  const navigateUp = useCallback(async () => {
    if (!currentPath || currentPath === folder) return;
    const lastSep = Math.max(currentPath.lastIndexOf('\\'), currentPath.lastIndexOf('/'));
    const parent = currentPath.slice(0, lastSep);
    if (!parent || parent.length < folder.length) {
      await loadPath(folder);
    } else {
      await loadPath(parent);
    }
  }, [currentPath, folder, loadPath]);

  const refreshCurrentPath = useCallback(async () => {
    if (!currentPath) return;
    const result = await window.api.readFolder(currentPath);
    setImages(result.images);
    setSubfolders(result.subfolders);
    setImageMeta(prev => {
      const newPaths = result.images.filter(img =>
        img.filePath.toLowerCase().endsWith('.png') && !prev[img.filePath]
      );
      newPaths.forEach(img => {
        window.api.getPngMeta(img.filePath)
          .then(meta => { if (meta) setImageMeta(p => ({ ...p, [img.filePath]: meta })); })
          .catch(() => {});
      });
      return prev;
    });
  }, [currentPath]);

  const toggleOption = useCallback((key) => {
    setViewOptions(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('viewOptions', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((filePath) => {
    setSelectedPaths(prev =>
      prev.includes(filePath) ? prev.filter(p => p !== filePath) : [...prev, filePath]
    );
  }, []);

  const handleClearSelection = useCallback(() => setSelectedPaths([]), []);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const navigate = useCallback((dir) => {
    setLightboxIndex(i => Math.max(0, Math.min(navImages.length - 1, i + dir)));
  }, [navImages.length]);

  // Grid and Lightbox both call onSelect/onDelete with the image filePath.
  const handleSelect = useCallback((filePath) => {
    const idx = navImages.findIndex(img => img.filePath === filePath);
    if (idx >= 0) setLightboxIndex(idx);
  }, [navImages]);

  const handleDelete = useCallback(async (filePath) => {
    await window.api.deleteFile(filePath);
    const newImages = images.filter(img => img.filePath !== filePath);
    setImages(newImages);
    if (lightboxIndex !== null) {
      const deletedNavIdx = navImages.findIndex(img => img.filePath === filePath);
      const newNavLen = navImages.length - 1;
      if (newNavLen === 0) {
        setLightboxIndex(null);
      } else if (deletedNavIdx >= 0 && lightboxIndex >= newNavLen) {
        setLightboxIndex(newNavLen - 1);
      }
    }
  }, [images, navImages, lightboxIndex]);

  // Restore last folder on startup
  useEffect(() => {
    if (!window.api) return;
    window.api.getLastFolder().then(async (dirPath) => {
      if (!dirPath) return;
      setFolder(dirPath);
      await loadPath(dirPath);
    }).catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft')  navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
      if (e.key === 'Delete') {
        const fp = navImages[lightboxIndex]?.filePath;
        if (fp) handleDelete(fp);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, closeLightbox, navigate, handleDelete, navImages]);

  // Fullscreen state sync
  useEffect(() => {
    if (!window.api) return;
    const handler = (v) => setIsFullscreen(v);
    window.api.onFullscreenChanged(handler);
    return () => window.api.offFullscreenChanged(handler);
  }, []);

  // Folder watcher — watches the currently browsed path
  useEffect(() => {
    if (!window.api) return;
    window.api.setWatchFolder(currentPath || null);
    if (!currentPath) return;
    const handler = () => refreshCurrentPath();
    window.api.onFolderChanged(handler);
    return () => window.api.offFolderChanged(handler);
  }, [currentPath, refreshCurrentPath]);

  return (
    <div className="app">
      {!isFullscreen && (
        <Toolbar
          folder={folder}
          currentPath={currentPath}
          count={images.length}
          onOpenFolder={openFolder}
          onRefresh={refreshCurrentPath}
          onNavigateUp={navigateUp}
          viewOptions={viewOptions}
          onToggleOption={toggleOption}
          selectedCount={selectedPaths.length}
          onCompare={() => setShowCompare(true)}
          onClearSelection={handleClearSelection}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )}
      {activeTab === 'images' && (
        images.length === 0 && subfolders.length === 0 ? (
          <div className="empty">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p>Open a folder to view images</p>
          </div>
        ) : (
          <Grid
            images={images}
            subfolders={subfolders}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onNavigateInto={navigateInto}
            imageMeta={imageMeta}
            viewOptions={viewOptions}
            selectedPaths={selectedPaths}
            onToggleSelect={handleToggleSelect}
            isFullscreen={isFullscreen}
          />
        )
      )}
      {activeTab === 'comfyui' && <ComfyUITab />}
      {activeTab === 'builder' && (
        <PromptBuilderTab
          pendingImport={pendingPromptImport}
          onConsumeImport={() => setPendingPromptImport(null)}
        />
      )}
      {lightboxIndex !== null && (
        <Lightbox
          images={navImages}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={navigate}
          onDelete={handleDelete}
          onEditInBuilder={handleEditInBuilder}
          isFullscreen={isFullscreen}
        />
      )}
      {showCompare && (
        <ComparePanel
          selectedPaths={selectedPaths}
          imageMeta={imageMeta}
          images={images}
          onClose={() => setShowCompare(false)}
          onEditInBuilder={handleEditInBuilder}
        />
      )}
    </div>
  );
}
