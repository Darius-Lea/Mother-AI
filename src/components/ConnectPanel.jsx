import { useEffect, useRef, useState } from 'react';
import { downloadMemory, importMemory, MAX_MEMORY_BYTES } from '../lib/memory.js';

export default function ConnectPanel({ memory, onMemoryChange, installAvailable=false, onInstall, onOpenSetup, hostedPreview=false }) {
  const [models, setModels] = useState([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const fileInput = useRef(null);

  async function refreshModels() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/models', { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check the local model service.');
      setModels(Array.isArray(data.models) ? data.models : []);
      setAvailable(data.available === true);
      if (!data.available) setNotice('Ollama is not running on the server. Your visual companion and local memory still work.');
      else setNotice('Connected to your local Ollama service.');
    } catch (failure) {
      setAvailable(false);
      setError(failure.message || 'Could not reach the local service.');
    } finally { setBusy(false); }
  }

  useEffect(() => { if(!hostedPreview)refreshModels(); }, [hostedPreview]);

  async function inspectImport(file) {
    setError('');
    setNotice('');
    setPendingImport(null);
    try {
      if (!file || file.size > MAX_MEMORY_BYTES) throw new Error('Choose a Mother memory JSON file smaller than 8 MB.');
      const imported = importMemory(await file.text());
      setPendingImport(imported);
    } catch (failure) { setError(failure.message); }
  }

  const capabilities = [
    ['Voice output', 'speechSynthesis' in globalThis ? 'Available in this browser' : 'Unavailable in this browser'],
    ['Voice input', globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition ? 'Browser recognition available; may use its online service' : 'Use text input on this browser'],
    ['Bluetooth', globalThis.navigator?.bluetooth ? 'Browser API present; compatible devices require explicit pairing' : 'Not exposed by this browser'],
    ['Device sharing', globalThis.navigator?.share ? 'Native sharing available' : 'Export a memory file to transfer'],
  ];

  return (
    <div className="panel-content connect-panel">
      <div className="panel-intro"><span className="eyebrow">YOURS, WHEREVER YOU GO</span><h2>A companion. Your control.</h2><p>{hostedPreview?'Keep your preferences and memory in this browser, then carry them to another Mother installation.':'Run a free local model, keep your memories, and carry them to another Mother installation.'}</p></div>
      <section className="connection-section">
        <h3>Make this space yours</h3>
        <label className="field-label" htmlFor="profile-name">What should Mother call you?</label>
        <input id="profile-name" autoComplete="given-name" value={memory.profile.name || ''} maxLength={100} placeholder="Your name" onChange={(event) => onMemoryChange({ ...memory, profile: { ...memory.profile, name: event.target.value } })} />
        <label className="checkbox-field"><input type="checkbox" checked={memory.settings.reducedMotion === true} onChange={(event) => onMemoryChange({ ...memory, settings: { ...memory.settings, reducedMotion: event.target.checked } })} />Reduce particle motion</label>
        <p className="field-hint">Your preferences are kept in this browser and included in memory exports.</p>
      </section>
      {!hostedPreview && <section className="connection-section">
        <div className="section-heading"><h3>Local intelligence</h3><span className={`badge ${available ? 'connected' : ''}`}>{available ? 'Connected' : 'Not connected'}</span></div>
        <div className="button-row"><button type="button" className="button primary" onClick={onOpenSetup}>Open guided setup</button></div>
        <p style={{marginTop:12}}>Mother uses Ollama for real neural-model conversations, with no paid API key. Model downloads require internet, disk space, and suitable hardware; local inference can work offline afterward.</p>
        <label className="field-label" htmlFor="local-model">Installed model</label>
        <div className="inline-field">
          <select id="local-model" value={memory.settings.model || ''} onChange={(event) => onMemoryChange({ ...memory, settings: { ...memory.settings, model: event.target.value } })}>
            <option value="">Select an installed model</option>
            {memory.settings.model && !models.some((model) => (typeof model === 'string' ? model : model.name) === memory.settings.model) && <option value={memory.settings.model}>{memory.settings.model} (not detected)</option>}
            {models.map((model) => { const name = typeof model === 'string' ? model : model.name; return <option key={name} value={name}>{name}</option>; })}
          </select>
          <button type="button" className="button secondary" disabled={busy} onClick={refreshModels}>{busy ? 'Checking…' : 'Refresh'}</button>
        </div>
        <details className="setup-details"><summary>Set up a free local brain</summary><p>Install <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> on the computer hosting Mother. Then, in a terminal:</p><pre>ollama serve{'\n'}ollama pull qwen2.5:0.5b</pre><p>Run these in separate terminals if needed. The example is a small starter model; larger models may answer better but need more memory. Refresh here and select the model after the download completes.</p></details>
      </section>}
      <section className="connection-section">
        <div className="section-heading"><h3>Portable memory</h3><span className="badge">Local first</span></div>
        <p>Export your conversations, reviewed sources, feedback, and preferences. Copy the JSON file to a USB drive or share it with another device, then import it there.</p>
        <p className="field-hint">Exports contain readable personal data. Store them privately. Model files and the application are separate; this is a memory transfer, not automatic device migration.</p>
        <div className="button-row">
          <button type="button" className="button primary" onClick={() => {
            setError('');
            try { downloadMemory(memory); setNotice('Memory export created. Keep your file private.'); }
            catch (failure) { setError(failure.message); }
          }}>↓ Export memory</button>
          <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}>↥ Import memory</button>
          <input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label="Import Mother memory file" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) inspectImport(file);
            event.target.value = '';
          }} />
        </div>
        {pendingImport && <div className="source-review">
          <h3>Replace this device’s memory?</h3>
          <p>This file contains {pendingImport.conversations.length} conversation records, {pendingImport.knowledge.length} sources, and {pendingImport.feedback.length} feedback entries. Export your current memory first if you want to keep it.</p>
          <div className="button-row"><button type="button" className="button primary" onClick={() => {
            onMemoryChange(pendingImport);
            setPendingImport(null);
            setNotice('Memory imported. Your local model selection may need updating on this device.');
          }}>Replace memory</button><button type="button" className="button ghost" onClick={() => setPendingImport(null)}>Cancel</button></div>
        </div>}
      </section>
      <section className="connection-section">
        <h3>This device</h3>
        {installAvailable ? <div className="button-row"><button type="button" className="button secondary" onClick={onInstall}>Install Mother on this device</button></div> : <p className="field-hint">On a compatible browser, use its Install app or Add to Home Screen option. Installation requires HTTPS or localhost and browser support.</p>}
        <dl className="capability-list">{capabilities.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="field-hint">Wi-Fi can connect a browser to a Mother server on your own network. Bluetooth does not install software or grant control of arbitrary devices. Each integration needs compatible software and your permission.</p>
      </section>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
    </div>
  );
}
