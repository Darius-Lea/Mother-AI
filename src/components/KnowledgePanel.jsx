import { useMemo, useRef, useState } from 'react';
import { downloadTrainingExamples, exportTrainingExamples, inspectLocalDataset, makeId } from '../lib/memory.js';

export default function KnowledgePanel({ memory, onMemoryChange }) {
  const [url, setUrl] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [opened, setOpened] = useState(null);
  const [editingFeedback, setEditingFeedback] = useState(null);
  const [correction, setCorrection] = useState('');
  const upload = useRef(null);
  const teachingExamples = useMemo(() => exportTrainingExamples(memory), [memory.feedback]);
  const teachingCount = teachingExamples ? teachingExamples.split('\n').length : 0;

  async function inspect(operation) {
    setError('');
    setNotice('');
    setBusy(true);
    setCandidate(null);
    setApproved(false);
    try {
      const data = await operation();
      if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('This source did not provide readable dataset text. Download a .txt, .json, .jsonl, or .csv file instead.');
      setCandidate(data);
    } catch (failure) {
      setError(failure.message || 'The source could not be inspected.');
    } finally {
      setBusy(false);
    }
  }

  async function inspectLink(event) {
    event.preventDefault();
    const target = url.trim();
    await inspect(async () => {
      const response = await fetch('/api/datasets/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The dataset could not be inspected.');
      return data;
    });
  }

  function addSource() {
    if (!candidate || !approved) return;
    if (memory.knowledge.length >= 100) {
      setError('The library supports 100 sources. Remove a source before adding another.');
      return;
    }
    if (candidate.sha256 && memory.knowledge.some((entry) => entry.sha256 === candidate.sha256)) {
      setError('This exact dataset is already in Mother’s library.');
      return;
    }
    const entry = {
      id: makeId(),
      title: `${candidate.title || candidate.url?.split('/').pop() || 'Reviewed dataset'}${candidate.truncated ? ' (excerpt)' : ''}`,
      source: candidate.url || url.trim(),
      text: candidate.text,
      sha256: candidate.sha256 || '',
      addedAt: new Date().toISOString(),
      approved: true,
      warnings: candidate.warnings || [],
    };
    onMemoryChange({ ...memory, knowledge: [...memory.knowledge, entry] });
    setCandidate(null);
    setApproved(false);
    setUrl('');
    setNotice('Source added. Relevant excerpts can now accompany your conversations.');
  }

  return (
    <div className="panel-content knowledge-panel">
      <div className="panel-intro">
        <span className="eyebrow">LEARN WITH CARE</span>
        <h2>A growing understanding.</h2>
        <p>Give Mother sources you trust. Review each one before it joins her local reference library.</p>
      </div>
      <div className="info-callout">
        <strong>Reference memory, with you in control.</strong>
        <p>Documents add context to answers. They do not change neural model weights or guarantee that a claim is true. Source text is treated as data, not instructions.</p>
      </div>
      <form onSubmit={inspectLink} className="dataset-form">
        <label className="field-label" htmlFor="dataset-url">Dataset link</label>
        <div className="inline-field">
          <input id="dataset-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/dataset.json" disabled={busy} />
          <button className="button primary" type="submit" disabled={busy || !url.trim()}>{busy ? 'Inspecting…' : 'Inspect'}</button>
        </div>
        <p className="field-hint">Public HTTPS text, JSON, JSONL, CSV, or Markdown · 2 MB maximum</p>
      </form>
      <div className="upload-row">
        <input ref={upload} type="file" accept=".txt,.json,.jsonl,.csv,.md" hidden aria-label="Upload dataset file" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) inspect(() => inspectLocalDataset(file));
          event.target.value = '';
        }} />
        <button type="button" className="button secondary" onClick={() => upload.current?.click()} disabled={busy}>↥ Upload a dataset</button>
        <span className="muted">Files stay on this device.</span>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {candidate && (
        <section className="source-review" aria-label="Review dataset before approval">
          <div className="section-heading"><h3>Review this source</h3><span className="badge">{Math.ceil(candidate.bytes / 1024)} KB</span></div>
          <p className="source-url">{candidate.url}</p>
          {candidate.truncated && <p className="review-warning">This source is larger than the reference limit. Only the first {candidate.text.length.toLocaleString()} characters will be stored. The checksum identifies the complete downloaded source.</p>}
          {candidate.sha256 && <p className="checksum" title={candidate.sha256}>SHA-256 · {candidate.sha256.slice(0, 20)}…</p>}
          <pre className="dataset-preview">{candidate.preview || candidate.text.slice(0, 3000)}</pre>
          <p className="field-hint">Preview only; verify the complete source, author, and usage license.</p>
          {(candidate.warnings || []).map((warning, index) => <p className="review-warning" key={index}>{warning}</p>)}
          <label className="checkbox-field"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />I reviewed the source and approve using it as reference material.</label>
          <div className="button-row">
            <button type="button" className="button primary" disabled={!approved} onClick={addSource}>Add to knowledge</button>
            <button type="button" className="button ghost" onClick={() => setCandidate(null)}>Discard</button>
          </div>
        </section>
      )}
      <section className="knowledge-library">
        <div className="section-heading"><h3>Reference library</h3><span className="badge">{memory.knowledge.length} sources</span></div>
        {!memory.knowledge.length && <div className="empty-state"><span aria-hidden="true">✧</span><h3>A thoughtful beginning.</h3><p>Add a small, trusted dataset to help Mother understand what matters to you.</p></div>}
        {memory.knowledge.map((entry) => (
          <article className="knowledge-entry" key={entry.id}>
            <div className="section-heading"><strong>{entry.title}</strong><span className="badge">{entry.approved ? 'Reviewed' : 'Unreviewed'}</span></div>
            <p className="source-url">{entry.source}</p>
            <div className="button-row">
              <button type="button" className="button ghost small" onClick={() => setOpened(opened === entry.id ? null : entry.id)}>{opened === entry.id ? 'Close preview' : 'Read source'}</button>
              <button type="button" className="button ghost small danger" onClick={() => onMemoryChange({ ...memory, knowledge: memory.knowledge.filter((source) => source.id !== entry.id) })}>Remove</button>
            </div>
            {opened === entry.id && <pre className="dataset-preview">{entry.text.slice(0, 10000)}{entry.text.length > 10000 ? '\n… Preview limited to 10,000 characters.' : ''}</pre>}
          </article>
        ))}
      </section>
      <section className="feedback-library">
        <div className="section-heading"><h3>Your teaching notes</h3><span className="badge">{memory.feedback.length} saved</span></div>
        <p className="field-hint">Feedback records examples for your review and export. It does not retrain the model automatically. Write a corrected answer to build useful training examples.</p>
        <div className="button-row"><button type="button" className="button secondary" disabled={!teachingCount} onClick={() => {
          try {
            downloadTrainingExamples(memory);
            setNotice(`Exported ${teachingCount} curated teaching example${teachingCount === 1 ? '' : 's'} as JSONL. This exports data; it does not update model weights.`);
          } catch (failure) { setError(failure.message); }
        }}>↓ Export teaching examples</button><span className="muted">{teachingCount} ready</span></div>
        <p className="field-hint">Includes your corrections and helpful responses from identified local models. Guide replies and unreviewed conversations are excluded. Fine-tuning is a separate process; no model weights change here.</p>
        {!memory.feedback.length && <p className="muted">Rate a response in your conversation to start teaching Mother.</p>}
        {memory.feedback.slice(-10).reverse().map((entry) => (
          <article className="knowledge-entry feedback-entry" key={entry.id}>
            <div className="section-heading"><strong>{['helpful', 'positive', 'up', 1].includes(entry.rating) ? 'Helpful response' : 'Needs improvement'}</strong><span className="badge">{entry.correction ? 'Corrected' : 'Rated'}</span></div>
            {entry.prompt && <p className="feedback-prompt"><strong>You asked:</strong> {entry.prompt.slice(0, 250)}{entry.prompt.length > 250 ? '…' : ''}</p>}
            {entry.response && <details className="setup-details"><summary>Original response</summary><p className="feedback-response">{entry.response}</p></details>}
            {editingFeedback === entry.id ? <div className="correction-editor">
              <label className="field-label" htmlFor={`correction-${entry.id}`}>What should Mother have said?</label>
              <textarea id={`correction-${entry.id}`} value={correction} onChange={(event) => setCorrection(event.target.value)} maxLength={10000} rows={5} placeholder="Write a better answer, or explain what was missing…" />
              <div className="button-row"><button type="button" className="button primary" disabled={!correction.trim()} onClick={() => {
                onMemoryChange({ ...memory, feedback: memory.feedback.map((item) => item.id === entry.id ? { ...item, correction: correction.trim() } : item) });
                setEditingFeedback(null);
                setNotice('Correction saved as a teaching example. Model weights have not changed.');
              }}>Save correction</button><button type="button" className="button ghost" onClick={() => setEditingFeedback(null)}>Cancel</button></div>
            </div> : <>
              {entry.correction && <p className="feedback-correction"><strong>Your correction:</strong> {entry.correction}</p>}
              <button type="button" className="button ghost small" onClick={() => { setEditingFeedback(entry.id); setCorrection(entry.correction || ''); }}>{entry.correction ? 'Edit correction' : 'Add a correction'}</button>
            </>}
          </article>
        ))}
      </section>
    </div>
  );
}
