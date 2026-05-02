import { useState, useEffect, useRef } from 'react';

const toFileUrl = (fp) => 'file:///' + fp.replace(/\\/g, '/');

const PARAMS = [
  { key: 'model',          label: 'Model' },
  { key: 'seed',           label: 'Seed',           mono: true },
  { key: 'steps',          label: 'Steps' },
  { key: 'cfg',            label: 'CFG' },
  { key: 'sampler',        label: 'Sampler' },
  { key: 'scheduler',      label: 'Scheduler' },
  { key: '_resolution',    label: 'Resolution' },
  { key: 'upscaleModel',   label: 'Upscale Model' },
  { key: 'upscaleMethod',  label: 'Upscale Method' },
  { key: 'upscaleFactor',  label: 'Upscale Factor',  mono: true },
  { key: 'loras',          label: 'LoRAs' },
  { key: 'positivePrompt', label: 'Positive Prompt' },
  { key: 'negativePrompt', label: 'Negative Prompt' },
];

function formatValue(key, meta) {
  if (!meta) return '—';
  if (key === '_resolution') {
    return (meta.genWidth != null && meta.genHeight != null)
      ? `${meta.genWidth} × ${meta.genHeight}`
      : '—';
  }
  const v = meta[key];
  if (v == null) return '—';
  if (key === 'loras') {
    if (!Array.isArray(v) || v.length === 0) return '—';
    return v.map(l => {
      const name = l.name.replace(/\.[^.]+$/, '').split(/[\\/]/).pop();
      const s = l.strengthModel != null ? l.strengthModel : l.strengthClip;
      return `${name}${s != null ? ` (${s})` : ''}`;
    }).join('\n');
  }
  return String(v);
}

function PromptDiff({ values, index }) {
  const current = values[index];
  if (current === '—') return <span className="compare-text-wrap">—</span>;

  const otherSets = values
    .filter((_, i) => i !== index)
    .map(v => v === '—' ? new Set() : new Set(v.split(',').map(t => t.trim().toLowerCase())));

  const tokens = current.split(',');

  return (
    <span className="compare-text-wrap">
      {tokens.map((token, i) => {
        const norm = token.trim().toLowerCase();
        const isUnique = norm !== '' && otherSets.some(set => !set.has(norm));
        return (
          <span key={i}>
            <span className={isUnique ? 'prompt-diff-highlight' : ''}>{token}</span>
            {i < tokens.length - 1 ? ',' : ''}
          </span>
        );
      })}
    </span>
  );
}

function CompareSlider({ pathA, pathB, dims }) {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef(null);
  const areaRef = useRef(null);

  useEffect(() => {
    if (!areaRef.current) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setAreaSize({ w: r.width, h: r.height });
    });
    ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, []);

  const updatePos = (clientX) => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (r.width === 0) return;
    const p = ((clientX - r.left) / r.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  };

  const onPointerDown = (e) => {
    setDragging(true);
    updatePos(e.clientX);
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => updatePos(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging]);

  // Compute the largest size that maintains aspect ratio inside the area.
  let dispW = 0, dispH = 0;
  if (dims.w > 0 && dims.h > 0 && areaSize.w > 0 && areaSize.h > 0) {
    const ar = dims.w / dims.h;
    const cAr = areaSize.w / areaSize.h;
    if (ar > cAr) { dispW = areaSize.w; dispH = areaSize.w / ar; }
    else          { dispH = areaSize.h; dispW = areaSize.h * ar; }
  }

  return (
    <div className="compare-slider-area" ref={areaRef}>
      {dispW > 0 && (
        <div
          className="compare-slider-wrap"
          ref={wrapRef}
          style={{ width: dispW, height: dispH }}
          onPointerDown={onPointerDown}
        >
          <img src={toFileUrl(pathB)} className="compare-slider-img" draggable={false} alt="" />
          <div className="compare-slider-clip" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <img src={toFileUrl(pathA)} className="compare-slider-img" draggable={false} alt="" />
          </div>
          <div className="compare-slider-handle" style={{ left: `${pos}%` }}>
            <div className="compare-slider-knob">‹›</div>
          </div>
          <div className="compare-slider-tag compare-slider-tag-left">A</div>
          <div className="compare-slider-tag compare-slider-tag-right">B</div>
        </div>
      )}
    </div>
  );
}

export default function ComparePanel({ selectedPaths, imageMeta, images, onClose, onEditInBuilder }) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [dims, setDims] = useState({});
  const [fullscreen, setFullscreen] = useState(false);

  const selectedImages = selectedPaths
    .map(fp => images.find(img => img.filePath === fp))
    .filter(Boolean);

  // Load natural dimensions for the selected images so we can detect a matching pair.
  useEffect(() => {
    let cancelled = false;
    Promise.all(selectedPaths.map(fp => new Promise(res => {
      const img = new Image();
      img.onload  = () => res({ fp, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ fp, w: 0, h: 0 });
      img.src = toFileUrl(fp);
    }))).then(results => {
      if (cancelled) return;
      const d = {};
      results.forEach(r => { d[r.fp] = { w: r.w, h: r.h }; });
      setDims(d);
    });
    return () => { cancelled = true; };
  }, [selectedPaths.join('|')]);

  const sliderMode =
    selectedPaths.length === 2 &&
    dims[selectedPaths[0]]?.w > 0 &&
    dims[selectedPaths[0]]?.w === dims[selectedPaths[1]]?.w &&
    dims[selectedPaths[0]]?.h === dims[selectedPaths[1]]?.h;

  // Drop fullscreen if we leave slider mode (e.g. selection changes).
  useEffect(() => {
    if (!sliderMode && fullscreen) setFullscreen(false);
  }, [sliderMode, fullscreen]);

  // Esc exits fullscreen mode.
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e) => {
      if (e.key === 'Escape') { setFullscreen(false); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const rows = PARAMS.map(param => {
    const values = selectedPaths.map(fp => formatValue(param.key, imageMeta[fp]));
    const allSame = values.every(v => v === values[0]);
    return { ...param, values, allSame };
  });

  const visibleRows = onlyDiffs ? rows.filter(r => !r.allSame) : rows;

  const renderRowValue = (row, val, i) => {
    const editBtn = row.key === 'positivePrompt' && val !== '—' && onEditInBuilder ? (
      <button
        className="compare-edit-builder"
        onClick={() => {
          const meta = imageMeta[selectedPaths[i]];
          onEditInBuilder({ positive: meta?.positivePrompt || '', negative: meta?.negativePrompt || '' });
        }}
        title="Load this prompt into Prompt Builder"
      >→ Builder</button>
    ) : null;
    if ((row.key === 'positivePrompt' || row.key === 'negativePrompt') && !row.allSame) {
      return <>{editBtn}<PromptDiff values={row.values} index={i} /></>;
    }
    const wrap =
      row.key === 'positivePrompt' ||
      row.key === 'negativePrompt' ||
      row.key === 'loras';
    return <>{editBtn}<span className={wrap ? 'compare-text-wrap' : ''}>{val}</span></>;
  };

  return (
    <div
      className={`compare-overlay${fullscreen ? ' compare-overlay-fullscreen' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`compare-panel${sliderMode ? ' compare-panel-slider' : ''}${fullscreen ? ' compare-panel-fullscreen' : ''}`}>
        <div className="compare-header">
          <span className="compare-title">Compare Images ({selectedImages.length})</span>
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={onlyDiffs}
              onChange={e => setOnlyDiffs(e.target.checked)}
            />
            Show only differences
          </label>
          {sliderMode && (
            <button
              className="compare-fullscreen"
              onClick={() => setFullscreen(f => !f)}
              title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            >
              {fullscreen ? '⤡' : '⤢'}
            </button>
          )}
          <button className="compare-close" onClick={onClose}>✕</button>
        </div>

        {sliderMode ? (
          <>
            <CompareSlider
              pathA={selectedPaths[0]}
              pathB={selectedPaths[1]}
              dims={dims[selectedPaths[0]]}
            />
            <div className="compare-diff-section">
              <div className="compare-diff-head">
                <div />
                <div className="compare-diff-head-cell">
                  <span className="compare-diff-tag">A</span>
                  <span className="compare-diff-name" title={selectedImages[0]?.name}>{selectedImages[0]?.name}</span>
                </div>
                <div className="compare-diff-head-cell">
                  <span className="compare-diff-tag">B</span>
                  <span className="compare-diff-name" title={selectedImages[1]?.name}>{selectedImages[1]?.name}</span>
                </div>
              </div>
              {visibleRows.length === 0 ? (
                <div className="compare-no-diff">All parameters are identical</div>
              ) : (
                visibleRows.map(row => (
                  <div key={row.key} className="compare-diff-row">
                    <div className="compare-diff-label">{row.label}</div>
                    {row.values.map((val, i) => (
                      <div key={i} className={`compare-diff-val${row.allSame ? '' : ' diff'}`}>
                        {renderRowValue(row, val, i)}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="compare-body">
            <table className="compare-table">
              <thead>
                <tr>
                  <th className="compare-th-label" />
                  {selectedImages.map(img => (
                    <th key={img.filePath} className="compare-th-img">
                      <img
                        src={toFileUrl(img.filePath)}
                        alt={img.name}
                        className="compare-thumb"
                      />
                      <div className="compare-img-name">{img.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={selectedImages.length + 1} className="compare-no-diff">
                      All parameters are identical
                    </td>
                  </tr>
                ) : (
                  visibleRows.map(row => (
                    <tr key={row.key}>
                      <td className="compare-label">{row.label}</td>
                      {row.values.map((val, i) => (
                        <td key={i} className={`compare-value${row.allSame ? '' : ' diff'}`}>
                          {renderRowValue(row, val, i)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
