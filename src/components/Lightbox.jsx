import { useState, useEffect, useRef } from 'react';

const toFileUrl = (filePath) => 'file:///' + filePath.replace(/\\/g, '/');

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (iso) => new Date(iso).toLocaleString();

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="8" strokeWidth="3" />
    <line x1="12" y1="12" x2="12" y2="16" />
  </svg>
);

function DetailRow({ label, value, mono }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export default function Lightbox({ images, index, onClose, onNavigate, onDelete, isFullscreen }) {
  const img = images[index];

  // Details panel state
  const [showDetails, setShowDetails] = useState(false);
  const [info,        setInfo]        = useState(null);
  const [dimensions,  setDimensions]  = useState(null);
  const [genMeta,     setGenMeta]     = useState(null);

  // Panel resize state
  const [panelWidth, setPanelWidth] = useState(270);
  const isResizing   = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing.current) return;
      const dx = resizeStartX.current - e.clientX;
      setPanelWidth(Math.min(600, Math.max(200, resizeStartW.current + dx)));
    };
    const onUp = () => { isResizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (e) => {
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = panelWidth;
    e.preventDefault();
    e.stopPropagation();
  };

  // Zoom / pan state
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart  = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset and fetch on image change
  useEffect(() => {
    setInfo(null);
    setDimensions(null);
    setGenMeta(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    window.api.getFileInfo(img.filePath).then(setInfo).catch(() => {});
    console.log('[debug] image opened:', img.filePath);
    console.log('[debug] getPngMeta available:', typeof window.api?.getPngMeta);
    if (img.filePath.toLowerCase().endsWith('.png')) {
      window.api.getPngMeta(img.filePath)
        .then(meta => {
          console.log('[ComfyMeta] result:', JSON.stringify(meta, null, 2));
          setGenMeta(meta);
        })
        .catch(err => console.error('[ComfyMeta] error:', err));
    } else {
      console.log('[debug] skipped - not a .png');
    }
  }, [img.filePath]);

  // 'I' key toggles details
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'i' || e.key === 'I') setShowDetails(s => !s);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Zoom / pan handlers ──────────────────────────────────────────────────
  const handleWheel = (e) => {
    e.preventDefault();
    const rect   = e.currentTarget.getBoundingClientRect();
    const mx     = e.clientX - rect.left  - rect.width  / 2;
    const my     = e.clientY - rect.top   - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(10, Math.max(1, zoom * factor));
    if (newZoom === 1) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const ratio = newZoom / zoom;
    setPan(p => ({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio }));
    setZoom(newZoom);
  };

  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    e.preventDefault();
    isDragging.current = true;
    dragStart.current  = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    setPan({
      x: dragStart.current.panX + e.clientX - dragStart.current.x,
      y: dragStart.current.panY + e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp     = () => { isDragging.current = false; };
  const handleDoubleClick = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div className="lightbox">
      {/* Details panel — rendered first so buttons stack above it */}
      <div className={`lb-details${showDetails ? ' open' : ''}`} style={{ width: panelWidth }}>
        <div className="lb-details-resize" onMouseDown={startResize} />
        <div className="lb-details-content">

          {genMeta && (
            <div className="gen-section">
              <h3 className="detail-title">Generation</h3>
              {genMeta.model          && <DetailRow label="Model"     value={genMeta.model} />}
              {genMeta.seed      != null && <DetailRow label="Seed"   value={String(genMeta.seed)} mono />}
              {genMeta.steps     != null && <DetailRow label="Steps"  value={String(genMeta.steps)} />}
              {genMeta.cfg       != null && <DetailRow label="CFG"    value={String(genMeta.cfg)} />}
              {genMeta.sampler        && <DetailRow label="Sampler"   value={genMeta.sampler} />}
              {genMeta.scheduler      && <DetailRow label="Scheduler" value={genMeta.scheduler} />}
              {(genMeta.genWidth != null && genMeta.genHeight != null) && (
                <DetailRow label="Resolution" value={`${genMeta.genWidth} × ${genMeta.genHeight}`} />
              )}
              {(genMeta.upscaleModel || genMeta.upscaleMethod || genMeta.upscaleFactor != null || genMeta.upscaleScheduler || genMeta.upscaleDenoise != null) && (
                <>
                  <div className="detail-subsection-title">Upscaler</div>
                  {genMeta.upscaleModel     && <DetailRow label="Name"      value={genMeta.upscaleModel} />}
                  {genMeta.upscaleMethod    && <DetailRow label="Method"    value={genMeta.upscaleMethod} />}
                  {genMeta.upscaleFactor    != null && <DetailRow label="Factor"    value={String(genMeta.upscaleFactor)} mono />}
                  {genMeta.upscaleScheduler && <DetailRow label="Scheduler" value={genMeta.upscaleScheduler} />}
                  {genMeta.upscaleDenoise   != null && <DetailRow label="Denoise"   value={String(genMeta.upscaleDenoise)} mono />}
                </>
              )}
              {genMeta.positivePrompt && <DetailRow label="Positive"  value={genMeta.positivePrompt} />}
              {genMeta.negativePrompt && <DetailRow label="Negative"  value={genMeta.negativePrompt} />}
              {genMeta.loras && genMeta.loras.length > 0 && (
                <>
                  <div className="detail-subsection-title">LoRAs</div>
                  {genMeta.loras.map((lora, i) => {
                    const name = lora.name.replace(/\.[^.]+$/, '').split(/[\\/]/).pop();
                    const sm = lora.strengthModel != null ? lora.strengthModel : null;
                    const sc = lora.strengthClip  != null ? lora.strengthClip  : null;
                    const strengthStr = sm != null && sc != null && sm !== sc
                      ? `model ${sm} / clip ${sc}`
                      : sm != null ? String(sm)
                      : sc != null ? String(sc)
                      : '—';
                    return <DetailRow key={i} label={name} value={strengthStr} mono />;
                  })}
                </>
              )}
            </div>
          )}

          <h3 className="detail-title">File</h3>
          <DetailRow label="Name" value={img.name} />
          {dimensions
            ? <DetailRow label="Dimensions" value={`${dimensions.w} × ${dimensions.h} px`} />
            : <DetailRow label="Dimensions" value="Loading…" />
          }
          {info ? (
            <>
              <DetailRow label="Size"     value={formatSize(info.size)} />
              <DetailRow label="Modified" value={formatDate(info.modified)} />
              <DetailRow label="Created"  value={formatDate(info.created)} />
            </>
          ) : (
            <DetailRow label="Size" value="Loading…" />
          )}
          <DetailRow label="Path" value={img.filePath} mono />
        </div>
      </div>

      {/* Buttons */}
      <button className="lb-close"  onClick={onClose}             title="Close (Esc)">✕</button>
      <button className="lb-delete" onClick={() => onDelete(img.filePath)} title="Move to Trash (Delete)"><TrashIcon /></button>
      <button className={`lb-info${showDetails ? ' active' : ''}`} onClick={() => setShowDetails(s => !s)} title="Details (I)"><InfoIcon /></button>

      {/* Image with zoom / pan */}
      <div
        className="lb-img-wrap"
        style={{
          cursor: zoom > 1 ? 'grab' : 'default',
          ...(isFullscreen && {
            maxWidth: '100vw',
            maxHeight: '100vh',
            width: '100vw',
            height: '100vh',
            borderRadius: 0,
            boxShadow: 'none',
          }),
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          key={img.filePath}
          className="lb-img"
          src={toFileUrl(img.filePath)}
          alt={img.name}
          draggable={false}
          onLoad={(e) => setDimensions({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
            transition: isDragging.current ? 'none' : 'transform 0.1s ease',
            ...(isFullscreen && { maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0, boxShadow: 'none' }),
          }}
        />
      </div>

      <div className="lb-nav">
        <button className="nav-btn" onClick={() => onNavigate(-1)}>←</button>
        <button className="nav-btn" onClick={() => onNavigate(1)}>→</button>
      </div>
      <span className="lb-caption">{img.name} ({index + 1} / {images.length})</span>
    </div>
  );
}
