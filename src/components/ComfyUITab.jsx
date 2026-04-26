import { useState, useCallback } from 'react';

function isNodeRef(val) {
  return Array.isArray(val) && val.length === 2 && typeof val[0] === 'string' && typeof val[1] === 'number';
}

function NodeInput({ nodeId, inputKey, value, onChange }) {
  if (isNodeRef(value)) {
    return <span className="node-link-badge">→ node {value[0]}[{value[1]}]</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={e => onChange(nodeId, inputKey, e.target.checked)}
      />
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => {
          const parsed = e.target.value.includes('.') ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
          onChange(nodeId, inputKey, isNaN(parsed) ? value : parsed);
        }}
      />
    );
  }
  const isLongText = typeof value === 'string' && (
    inputKey.toLowerCase().includes('prompt') ||
    inputKey.toLowerCase().includes('text') ||
    value.length > 80
  );
  if (isLongText) {
    return (
      <textarea
        value={value}
        rows={4}
        onChange={e => onChange(nodeId, inputKey, e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(nodeId, inputKey, e.target.value)}
    />
  );
}

function NodeCard({ nodeId, node, onInputChange }) {
  const inputs = node.inputs || {};
  const entries = Object.entries(inputs);
  return (
    <div className="node-card">
      <div className="node-card-header">
        <span className="node-card-id">#{nodeId}</span>
        <span className="node-card-type">{node.class_type}</span>
      </div>
      {entries.length === 0 ? (
        <div className="node-no-inputs">No editable inputs</div>
      ) : (
        <div className="node-inputs">
          {entries.map(([key, val]) => (
            <div key={key} className="node-input-row">
              <span className="node-input-label">{key}</span>
              <NodeInput nodeId={nodeId} inputKey={key} value={val} onChange={onInputChange} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ComfyUITab() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem('comfyuiUrl') || 'http://127.0.0.1:8188'
  );
  const [workflow, setWorkflow] = useState(null);
  const [status, setStatus] = useState({ text: '', type: 'idle' });
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);

  const handleUrlChange = (e) => {
    const url = e.target.value;
    setServerUrl(url);
    localStorage.setItem('comfyuiUrl', url);
  };

  const loadWorkflow = useCallback(async () => {
    const base = serverUrl.replace(/\/$/, '');
    setLoading(true);
    setStatus({ text: 'Connecting…', type: 'idle' });
    try {
      const res = await fetch(`${base}/history?max_items=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const history = await res.json();
      const entries = Object.values(history);
      if (entries.length === 0) {
        setStatus({ text: 'No history found. Run a workflow in ComfyUI first.', type: 'error' });
        setLoading(false);
        return;
      }
      // prompt[2] is the API-format workflow object
      const promptArr = entries[0].prompt;
      if (!promptArr || !promptArr[2]) {
        setStatus({ text: 'Could not parse workflow from history.', type: 'error' });
        setLoading(false);
        return;
      }
      setWorkflow(promptArr[2]);
      setStatus({ text: `Loaded ${Object.keys(promptArr[2]).length} nodes.`, type: 'success' });
    } catch (err) {
      setStatus({ text: `Failed to connect: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  }, [serverUrl]);

  const handleInputChange = useCallback((nodeId, inputKey, value) => {
    setWorkflow(prev => ({
      ...prev,
      [nodeId]: {
        ...prev[nodeId],
        inputs: { ...prev[nodeId].inputs, [inputKey]: value },
      },
    }));
  }, []);

  const queueWorkflow = useCallback(async () => {
    if (!workflow) return;
    const base = serverUrl.replace(/\/$/, '');
    setQueueing(true);
    setStatus({ text: 'Queueing…', type: 'idle' });
    try {
      const res = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const data = await res.json();
      setStatus({ text: `Queued! Prompt ID: ${data.prompt_id}`, type: 'success' });
    } catch (err) {
      setStatus({ text: `Queue failed: ${err.message}`, type: 'error' });
    }
    setQueueing(false);
  }, [serverUrl, workflow]);

  const sortedNodes = workflow
    ? Object.entries(workflow).sort(([a], [b]) => Number(a) - Number(b))
    : [];

  return (
    <div className="comfyui-tab">
      <div className="comfyui-connection">
        <input
          className="comfyui-url-input"
          type="text"
          value={serverUrl}
          onChange={handleUrlChange}
          placeholder="http://127.0.0.1:8188"
          spellCheck={false}
        />
        <button onClick={loadWorkflow} disabled={loading}>
          {loading ? 'Loading…' : 'Connect & Load'}
        </button>
      </div>

      <div className="comfyui-scroll">
        {workflow === null ? (
          <div className="comfyui-empty">
            <p>Connect to ComfyUI and load the most recent workflow to start editing.</p>
          </div>
        ) : (
          sortedNodes.map(([nodeId, node]) => (
            <NodeCard
              key={nodeId}
              nodeId={nodeId}
              node={node}
              onInputChange={handleInputChange}
            />
          ))
        )}
      </div>

      {workflow !== null && (
        <div className="comfyui-action-bar">
          {status.text && (
            <span className={`comfyui-status comfyui-status-${status.type}`}>{status.text}</span>
          )}
          <button onClick={queueWorkflow} disabled={queueing}>
            {queueing ? 'Queueing…' : 'Queue Prompt'}
          </button>
        </div>
      )}

      {workflow === null && status.text && (
        <div className="comfyui-action-bar">
          <span className={`comfyui-status comfyui-status-${status.type}`}>{status.text}</span>
        </div>
      )}
    </div>
  );
}
