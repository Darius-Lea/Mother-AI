import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Cpu, Download, ExternalLink, HardDrive, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react';

const ACTIVE_STATES = new Set(['queued', 'downloading', 'verifying']);
const modelName = (model) => typeof model === 'string' ? model : model?.name;
const formatBytes = (bytes) => Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : 'Waiting for byte counts';
const steps = ['Welcome', 'Local intelligence', 'Choose a brain', 'Ready'];

/** All readiness and download progress come from the local server, never simulated timers. */
export default function SetupWizard({ onComplete, onClose }) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const dialog = useRef(null);
  const heading = useRef(null);
  const pollInFlight = useRef(false);
  const taskActive = ACTIVE_STATES.has(task?.state);
  const mobileClient = /Android|iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || '') || (globalThis.navigator?.platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1);
  const installerAvailable = !mobileClient && ['win32', 'darwin'].includes(status?.hardware?.platform);
  const installed = status?.models || [];
  const selectedInstalled = installed.some((model) => modelName(model) === selected);
  const selectedRecommendation = status?.recommendations?.find((model) => model.name === selected);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`/api/setup${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: options.signal || AbortSignal.timeout(12000),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('Mother’s local setup service could not respond. Reopen Mother and try again.'); }
    if (!response.ok) throw new Error(result.error || 'This setup step could not be completed.');
    return result;
  }, []);

  const refreshStatus = useCallback(async () => {
    const result = await request('/status');
    if (!mounted.current) return result;
    setStatus(result);
    setSelected((current) => current || result.recommendedModel || modelName(result.models?.[0]) || result.recommendations?.find((model) => model.eligible)?.name || '');
    if (result.activeDownload) setTask(result.activeDownload);
    return result;
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    refreshStatus().catch((failure) => { if (mounted.current) setError(failure.message); });
    const previouslyFocused = document.activeElement;
    heading.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [refreshStatus, onClose]);

  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(()=>{if(step!==1||status?.runtime?.available)return;const timer=setInterval(()=>refreshStatus().catch(()=>{}),5000);return()=>clearInterval(timer);},[step,status?.runtime?.available,refreshStatus]);

  const verifyInstalled = useCallback(async (name) => {
    const result = await refreshStatus();
    if (!result.runtime?.available || !result.models?.some((model) => modelName(model) === name)) throw new Error('The model is not ready yet. Mother could not confirm it in the local model library. Refresh detection and try again.');
    if (mounted.current) { setSelected(name); setStep(3); setError(''); }
    return result;
  }, [refreshStatus]);

  const pollTask = useCallback(async (id) => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const result = await request(`/pull/${encodeURIComponent(id)}`);
      if (!mounted.current) return;
      setTask(result); setPollingError('');
      if (result.state === 'completed') await verifyInstalled(result.model);
      else if (result.state === 'error') setError(result.error || 'The model download failed. Check your connection and free disk space, then try again.');
      else if (result.state === 'cancelled') setNotice('Download cancelled. Ollama may retain completed layers so a later retry can resume.');
    } catch (failure) { if (mounted.current) setPollingError(`Could not check progress: ${failure.message} The download may still be running.`); }
    finally { pollInFlight.current = false; }
  }, [request, verifyInstalled]);

  useEffect(() => {
    if (!task?.id || !taskActive) return;
    pollTask(task.id);
    const timer = window.setInterval(() => pollTask(task.id), 1100);
    return () => window.clearInterval(timer);
  }, [task?.id, taskActive, pollTask]);

  async function detect() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await refreshStatus();
      if (result.runtime?.available) {
        setNotice('Local intelligence service detected. Choose a model next.');
        if (result.activeDownload) { setTask(result.activeDownload); setStep(2); }
      } else setNotice('Ollama is not running yet. Finish its installer, open Ollama, then check again.');
    } catch (failure) { setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function openRuntimeDownload() {
    setError('');
    try {
      if (window.motherDesktop?.openOllamaDownload) await window.motherDesktop.openOllamaDownload();
      else {
        const opened = window.open('https://ollama.com/download', '_blank', 'noopener,noreferrer');
        // Some browsers intentionally return null for noopener. The official link remains visible below.
        void opened;
      }
      setNotice(installerAvailable ? 'The official Ollama download page opens separately. Complete its normal Windows or Mac installer on the computer hosting Mother, open Ollama, then return here and select Check again.' : 'The official runtime information opens separately. Ollama must run on the computer hosting Mother. Linux setup may need an administrator; phones and tablets use Mother as a client of that computer.');
    } catch (failure) { setError(failure.message || 'Could not open the official download page. Use the link below.'); }
  }

  async function beginDownload() {
    if (!selected || taskActive) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (selectedInstalled) { await verifyInstalled(selected); return; }
      if (!consent) throw new Error('Confirm the model download before continuing.');
      if (!selectedRecommendation?.eligible) throw new Error('Choose a model recommended for this computer’s memory.');
      const result = await request('/pull', { method: 'POST', body: JSON.stringify({ model: selected }) });
      if (mounted.current) setTask(result);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function cancelDownload() {
    if (!task?.id) return;
    setBusy(true); setError('');
    try {
      const result = await request(`/pull/${encodeURIComponent(task.id)}/cancel`, { method: 'POST', body: '{}' });
      if (mounted.current) { setTask(result); setNotice('Download cancelled. You can choose a smaller model or retry later.'); }
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function finish() {
    setBusy(true); setError('');
    try { await verifyInstalled(selected); if (mounted.current) onComplete?.({ model: selected }); }
    catch (failure) { if (mounted.current) { setError(failure.message); setStep(2); } }
    finally { if (mounted.current) setBusy(false); }
  }

  return <div className="setup-overlay">
    <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-description" ref={dialog}>
      <header className="setup-header">
        <div className="setup-brand"><Sparkles size={20} /><span>MOTHER / WELCOME HOME</span></div>
        <button className="icon-btn" type="button" aria-label={taskActive ? 'Close setup; download continues' : 'Close setup'} onClick={onClose}><X size={19} /></button>
      </header>
      <ol className="setup-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={`${index === step ? 'current' : ''} ${index < step ? 'complete' : ''}`} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>
      <div className="setup-body">
        {step === 0 && <>
          <div className="setup-emblem"><Sparkles size={35} strokeWidth={1} /></div>
          <div className="eyebrow">A SIMPLE BEGINNING</div>
          <h2 id="setup-title" tabIndex={-1} ref={heading}>Let’s bring Mother to life.</h2>
          <p id="setup-description">A few guided steps will connect Mother to a free neural model on the computer hosting her. Mother handles model selection and downloads; your operating system may need to install the free runtime separately.</p>
          <div className="setup-benefits"><div><ShieldCheck size={18} /><span><strong>Your conversations stay local</strong><small>Model inference runs on the computer hosting Mother.</small></span></div><div><Cpu size={18} /><span><strong>A brain suited to your hardware</strong><small>Mother recommends a model using the host computer’s total system memory.</small></span></div><div><HardDrive size={18} /><span><strong>Free software, real resources</strong><small>Model downloads use internet, storage, and your computer’s processing power.</small></span></div></div>
          <p className="field-hint">Mother combines open models, references, and tools. Capabilities depend on the selected model; this setup does not promise the performance of ChatGPT, Codex, or Claude.</p>
          {taskActive && <div className="notice">A model download is already running. Continue to view its actual progress.</div>}
        </>}
        {step === 1 && <>
          <div className="eyebrow">THE ENGINE BEHIND MOTHER</div>
          <h2 id="setup-title" tabIndex={-1} ref={heading}>Local intelligence, made simple.</h2>
          <p id="setup-description">Ollama runs Mother’s free neural model. Mother checks the service on this server computer, not on a different device visiting it.</p>
          <div className={`setup-runtime ${status?.runtime?.available ? 'connected' : ''}`}><span className="setup-runtime-icon"><Cpu size={23} /></span><div><strong>{status?.runtime?.available ? 'Ollama is ready' : 'Ollama is not connected yet'}</strong><small>{status?.runtime?.available ? `Local service${status.runtime.version ? ` · version ${status.runtime.version}` : ''}` : 'Install the free runtime, then Mother can download a model for you.'}</small></div>{status?.runtime?.available && <CheckCircle2 size={20} />}</div>
          {status?.hardware && <dl className="setup-hardware"><div><dt>System memory</dt><dd>{Number(status.hardware.totalMemoryGiB).toFixed(1)} GB</dd></div><div><dt>Processor</dt><dd>{status.hardware.cpuCount} logical cores</dd></div><div><dt>Platform</dt><dd>{status.hardware.platform} · {status.hardware.arch}</dd></div></dl>}
          {!status?.runtime?.available && <div className="setup-runtime-actions"><button type="button" className="button primary" onClick={openRuntimeDownload}><Download size={15} /> {installerAvailable ? 'Get the free runtime' : 'Runtime setup information'} <ExternalLink size={13} /></button><p className="field-hint">{installerAvailable ? 'Complete the official installer and open Ollama. Your operating system may ask you to approve installation.' : mobileClient ? 'Phones and tablets connect to a compatible server host. Install the runtime on that host, not on this mobile client.' : 'Install Ollama on the computer hosting Mother. Linux installation may need an administrator or the official setup instructions.'} <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Official download</a></p><button type="button" className="button secondary" onClick={detect} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <Cpu size={14} />} Check again</button></div>}
          {status?.runtime?.available && <p className="success-message">No API key is required. The next step downloads a model only after you approve it.</p>}
        </>}
        {step === 2 && <>
          <div className="eyebrow">FREE MODELS. YOUR CHOICE.</div>
          <h2 id="setup-title" tabIndex={-1} ref={heading}>{taskActive ? 'A new mind is taking shape.' : 'Choose Mother’s local brain.'}</h2>
          <p id="setup-description">Larger models can handle more demanding work, but need more memory and can run slowly without a suitable graphics processor. Download sizes below are estimates.</p>
          {taskActive ? <section className="setup-download" aria-label="Model download progress" aria-live="polite">
            <div className="section-heading"><strong>{task.model}</strong><span className="badge">{task.state === 'verifying' ? 'Verifying installation' : 'Downloading'}</span></div>
            <progress aria-label="Model download" max="100" {...(Number.isFinite(task.progress) ? { value: task.progress } : {})} />
            <div className="setup-progress-label"><span>{task.status || 'Waiting for Ollama’s progress report…'}</span><strong>{Number.isFinite(task.progress) ? `${Math.round(task.progress)}%` : 'Preparing…'}</strong></div>
            <p className="field-hint">{formatBytes(task.completed)}{task.total ? ` of ${formatBytes(task.total)}` : ''}. Progress is reported by Ollama; verification may take additional time.</p>
            <button type="button" className="button secondary" onClick={cancelDownload} disabled={busy}>Cancel download</button>
            <p className="field-hint">You can close this window while the local server keeps running. Reopen setup to check the download. Closing Mother completely stops its progress connection.</p>
          </section> : <>
            {!!installed.length && <div className="setup-installed"><label className="field-label" htmlFor="setup-installed-model">Already installed on this computer</label><select id="setup-installed-model" value={selectedInstalled ? selected : ''} onChange={(event) => { setSelected(event.target.value); setConsent(false); setError(''); }}><option value="">Choose an installed model</option>{installed.map((model) => <option value={modelName(model)} key={modelName(model)}>{modelName(model)}</option>)}</select></div>}
            <fieldset className="setup-models"><legend>Available free model downloads</legend>{(status?.recommendations || []).map((model) => <label className={`setup-model-card ${selected === model.name ? 'selected' : ''} ${!model.eligible ? 'unavailable' : ''}`} key={model.name}><input type="radio" name="mother-model" value={model.name} checked={selected === model.name} disabled={!model.eligible || busy} onChange={() => { setSelected(model.name); setConsent(false); setError(''); }} /><span><span className="setup-model-heading"><strong>{model.label}</strong>{model.recommended && <span className="badge connected">Recommended</span>}</span><small className="setup-model-name">{model.name}</small><span className="setup-model-description">{model.description}</span><small className="setup-model-resources">~{model.downloadGiB} GB download · {model.minRamGiB} GB system memory{!model.eligible ? ' · More memory required' : ''}</small></span></label>)}</fieldset>
            {selected && !selectedInstalled && <label className="checkbox-field setup-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I approve downloading this free model{selectedRecommendation ? ` (approximately ${selectedRecommendation.downloadGiB} GB)` : ''}. I understand it uses this computer’s storage, memory, and processing power.</label>}
            {!selected && <p className="notice">No suitable model is selected. You can continue with the offline guide and set up a model later.</p>}
          </>}
          {pollingError && <div className="error-message" role="status"><p>{pollingError}</p><button type="button" className="button secondary small" onClick={() => pollTask(task.id)}>Check progress again</button></div>}
        </>}
        {step === 3 && <>
          <div className="setup-emblem ready"><CheckCircle2 size={42} strokeWidth={1.1} /></div>
          <div className="eyebrow">CONFIRMED ON THIS COMPUTER</div>
          <h2 id="setup-title" tabIndex={-1} ref={heading}>Mother’s local brain is ready.</h2>
          <p id="setup-description">The local service reports that <strong>{selected}</strong> is installed. Mother can now send your conversations and approved reference excerpts to that model.</p>
          <div className="setup-ready-summary"><Check size={16} /><span>Installed model verified</span><Check size={16} /><span>No paid API key</span><Check size={16} /><span>Your hardware, your control</span></div>
          <p className="field-hint">This confirms model installation. The quality and speed of actual replies depend on the model and hardware. Mother does not automatically retrain its weights or gain access to other apps.</p>
        </>}
        {error && <div className="error-message" role="alert">{error}</div>}
        {notice && <div className="success-message" role="status">{notice}</div>}
      </div>
      <footer className="setup-footer">
        <div>{step > 0 && !taskActive && step < 3 && <button type="button" className="button ghost" disabled={busy} onClick={() => { setStep(step - 1); setError(''); setNotice(''); }}><ArrowLeft size={14} /> Back</button>}<button type="button" className="button ghost" onClick={onClose}>{taskActive ? 'Close; keep downloading' : 'Continue with offline guide'}</button></div>
        {step === 0 && <button type="button" className="button primary" onClick={() => setStep(taskActive ? 2 : 1)}>Get started <ArrowRight size={15} /></button>}
        {step === 1 && <button type="button" className="button primary" disabled={!status?.runtime?.available || busy} onClick={() => { setStep(2); setError(''); setNotice(''); }}>Choose a model <ArrowRight size={15} /></button>}
        {step === 2 && !taskActive && <button type="button" className="button primary" disabled={busy || !selected || (!selectedInstalled && (!consent || !selectedRecommendation?.eligible))} onClick={beginDownload}>{busy ? <LoaderCircle className="spin" size={14} /> : selectedInstalled ? <Check size={14} /> : <Download size={14} />}{busy ? 'Checking…' : selectedInstalled ? 'Use installed model' : 'Download & set up'}</button>}
        {step === 3 && <button type="button" className="button primary" disabled={busy} onClick={finish}>{busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{busy ? 'Verifying…' : 'Meet Mother'}</button>}
      </footer>
    </section>
  </div>;
}
