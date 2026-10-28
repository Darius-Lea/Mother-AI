import { useEffect, useRef } from 'react';
import { Download, LoaderCircle, RefreshCw, X } from 'lucide-react';
import './UpdatePanel.css';

const labels = {
  idle: 'Keep Mother up to date', checking: 'Checking for an update…', current: 'You have the latest available build',
  available: 'A new Mother update is available', downloading: 'Downloading in the background…',
  verifying: 'Checking the downloaded update…', ready: 'Your update is ready to install',
  installing: 'Opening the update…', cancelled: 'Update download paused', error: 'Mother could not finish this update',
};
const bytes = value => `${((Number(value) || 0) / 1024 ** 2).toFixed(1)} MB`;

export default function UpdatePanel({ status = {}, onCheck, onDownload, onInstall, onCancel, onClose, isDesktop = false, busy = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, []);
  const state = status.state || 'idle';
  const loading = ['checking', 'downloading', 'verifying', 'installing'].includes(state);
  const downloading = ['downloading', 'verifying'].includes(state);
  const progress = Number.isFinite(status.progress) ? Math.max(0, Math.min(1, status.progress)) : null;
  const version = status.availableVersion || status.installedVersion;
  return <div className="update-overlay" onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section ref={dialog} className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="mother-update-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); }
      if (event.key === 'Tab') {
        const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="section-heading"><span className="eyebrow">MOTHER UPDATES</span><button type="button" className="icon-btn" onClick={onClose} aria-label="Close updates"><X size={18}/></button></div>
      <h2 id="mother-update-title">{labels[state] || labels.idle}</h2>
      {version && <p className="field-hint">{version}{status.availableCommit ? ` · build ${status.availableCommit.slice(0, 7)}` : ''}</p>}
      <p>{isDesktop ? 'Update Mother in place. Your conversations, settings, and downloaded models stay on this computer.' : 'Refresh Mother to load the latest website. Your saved conversations and settings stay in this browser.'}</p>
      {downloading && <div role="status" aria-live="polite" className="update-progress"><progress aria-label="Mother update download" max="1" {...(progress !== null ? { value: progress } : {})}/><span>{progress !== null ? `${Math.round(progress * 100)}% · ` : ''}{bytes(status.downloaded)}{status.total ? ` of ${bytes(status.total)}` : ''}</span><p className="field-hint">You can keep working while Mother downloads and checks the update.</p></div>}
      {state === 'ready' && <p className="notice">Save any unfinished work before installing. Mother will close so the normal installer can replace the app. Follow the operating system’s approval prompts, then reopen Mother.</p>}
      {!isDesktop && state === 'available' && <p className="field-hint">Refreshing closes this conversation session. Your saved messages stay here. Finish any spoken reply first.</p>}
      {busy && ['ready', 'available'].includes(state) && <p role="status" className="notice">Finish or stop the current reply before updating.</p>}
      {isDesktop && ['available', 'ready'].includes(state) && status.signing === 'unsigned' && <p className="field-hint">This preview installer is unsigned. Your operating system may show an approval prompt. Mother checks the download’s size and SHA-256 before opening it.</p>}
      {status.error && <p className="error-message" role="alert">{status.error}</p>}
      <div className="button-row update-actions">
        {state === 'available' && (isDesktop ? <button type="button" className="button primary" onClick={onDownload}><Download size={15}/>Download update</button> : <button type="button" className="button primary" onClick={onInstall} disabled={busy}><RefreshCw size={15}/>Update website</button>)}
        {isDesktop && state === 'ready' && <button type="button" className="button primary" onClick={onInstall} disabled={busy}><RefreshCw size={15}/>Install update</button>}
        {['idle', 'current', 'error', 'cancelled'].includes(state) && <button type="button" className="button primary" onClick={onCheck}><RefreshCw size={15}/>Check for updates</button>}
        {loading && <span className="update-working" role="status"><LoaderCircle size={15} className="spin"/>{state === 'installing' ? 'Preparing update…' : 'Working…'}</span>}
        <button type="button" className="button secondary" onClick={onClose}>{downloading ? 'Keep working' : 'Continue working'}</button>
        {state === 'downloading' && <button type="button" className="button ghost" onClick={onCancel}>Cancel download</button>}
      </div>
    </section>
  </div>;
}
