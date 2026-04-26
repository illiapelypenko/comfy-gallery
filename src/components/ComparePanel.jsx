import { useState } from 'react';

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

export default function ComparePanel({ selectedPaths, imageMeta, images, onClose }) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const selectedImages = selectedPaths
    .map(fp => images.find(img => img.filePath === fp))
    .filter(Boolean);

  const rows = PARAMS.map(param => {
    const values = selectedPaths.map(fp => formatValue(param.key, imageMeta[fp]));
    const allSame = values.every(v => v === values[0]);
    return { ...param, values, allSame };
  });

  const visibleRows = onlyDiffs ? rows.filter(r => !r.allSame) : rows;

  return (
    <div className="compare-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="compare-panel">
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
          <button className="compare-close" onClick={onClose}>✕</button>
        </div>

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
                        {(row.key === 'positivePrompt' || row.key === 'negativePrompt') && !row.allSame
                          ? <PromptDiff values={row.values} index={i} />
                          : (
                            <span className={
                              row.key === 'positivePrompt' ||
                              row.key === 'negativePrompt' ||
                              row.key === 'loras'
                                ? 'compare-text-wrap'
                                : ''
                            }>
                              {val}
                            </span>
                          )
                        }
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
