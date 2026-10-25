import {useRef, useState} from 'react';
import {FileCheck2, Code2, ShieldCheck, Copy, Check, AlertTriangle, Upload} from 'lucide-react';
import {reviewSource, compareDigest} from '../lib/security.js';

export default function ToolsPanel() {
  const [tab, setTab] = useState('integrity');
  const [fileState, setFileState] = useState(null);
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [report, setReport] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef(null);
  const digestState = fileState ? compareDigest(fileState.sha256, expected) : 'empty';

  async function hashFile(file) {
    if (!file) return;
    setError(''); setFileState(null); setBusy(true); setCopied(false);
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('Choose a file smaller than 32 MB for this browser tool.');
      if (!globalThis.crypto?.subtle) throw new Error('File hashing requires a secure browser context (HTTPS or localhost).');
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      setFileState({name: file.name, bytes: file.size, sha256});
    } catch (err) {setError(err.message || 'Unable to hash this file.');}
    finally {setBusy(false); if (fileInput.current) fileInput.current.value = '';}
  }

  function runReview() {
    setError('');
    try {setReport(reviewSource(source));}
    catch (err) {setError(err.message); setReport(null);}
  }

  return <div className="panel-stack tools-panel">
    <div className="notice"><ShieldCheck size={18}/><span>Tools run on this device. Review code and files you own or have permission to test.</span></div>
    <div className="segmented-control" role="tablist" aria-label="Security tools" style={{display:'flex', gap:8}}>
      <button type="button" role="tab" aria-selected={tab === 'integrity'} className={`btn ${tab === 'integrity' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => {setTab('integrity');setError('');}}><FileCheck2 size={15}/> File integrity</button>
      <button type="button" role="tab" aria-selected={tab === 'code'} className={`btn ${tab === 'code' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => {setTab('code');setError('');}}><Code2 size={15}/> Code review</button>
    </div>
    {tab === 'integrity' ? <section className="panel-stack" aria-label="File integrity">
      <div><h3>Know what changed.</h3><p className="muted">Calculate a SHA-256 fingerprint without uploading your file. Compare it with a checksum from a trusted publisher.</p></div>
      <div className="card" style={{padding:20, textAlign:'center'}}>
        <Upload size={26} style={{margin:'0 auto 12px'}}/>
        <label className="field-label" htmlFor="integrity-file">Select a file · up to 32 MB</label>
        <input ref={fileInput} id="integrity-file" type="file" disabled={busy} onChange={event => hashFile(event.target.files?.[0])}/>
        {busy && <p role="status">Calculating fingerprint…</p>}
      </div>
      {fileState && <div className="card panel-stack" style={{padding:16}}>
        <div><strong style={{overflowWrap:'anywhere'}}>{fileState.name}</strong><p className="muted">{fileState.bytes.toLocaleString()} bytes · SHA-256</p></div>
        <code style={{display:'block', overflowWrap:'anywhere',fontSize:12,lineHeight:1.8}}>{fileState.sha256}</code>
        <button className="btn btn-secondary" type="button" onClick={async () => {try {await navigator.clipboard.writeText(fileState.sha256);setCopied(true);}catch {setError('Clipboard is unavailable. Select and copy the fingerprint above.');}}}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy fingerprint'}</button>
        <label className="field-label" htmlFor="expected-digest">Expected SHA-256 (optional)</label>
        <input className="text-input" id="expected-digest" value={expected} onChange={event => setExpected(event.target.value)} placeholder="Paste the publisher’s 64-character checksum" autoComplete="off" spellCheck={false}/>
        {digestState === 'invalid' && <p className="muted" role="status">Enter exactly 64 hexadecimal characters.</p>}
        {digestState === 'match' && <p className="notice" role="status"><Check size={16}/> Fingerprints match. This confirms equality with the supplied checksum, not that the file is safe.</p>}
        {digestState === 'mismatch' && <p className="notice" role="alert"><AlertTriangle size={16}/> Fingerprints differ. Verify the source before using this file.</p>}
      </div>}
      <p className="muted">A fingerprint detects changes. It does not scan for malware or establish who published a file.</p>
    </section> : <section className="panel-stack" aria-label="Static source review">
      <div><h3>A first look at your code.</h3><p className="muted">Local pattern checks highlight common areas for review. This is not an AI audit: context can make a match safe, and vulnerabilities may go undetected.</p></div>
      <label className="field-label" htmlFor="review-source">Source code</label>
      <textarea className="textarea text-input" id="review-source" rows={11} maxLength={200_000} value={source} onChange={event => {setSource(event.target.value);setReport(null);}} placeholder="Paste code to review. Nothing is executed or uploaded." spellCheck={false} style={{fontFamily:'monospace',fontSize:12}}/>
      <button type="button" className="btn btn-primary" onClick={runReview} disabled={!source.trim()}><Code2 size={15}/> Review patterns</button>
      {report && <div className="panel-stack" aria-live="polite">
        <p className="muted">{report.lines} lines checked · {report.findings.length} {report.findings.length === 1 ? 'finding' : 'findings'} · {report.high} high priority</p>
        {!report.findings.length && <div className="notice"><Check size={17}/><span>No patterns matched. This does not establish that the code is secure.</span></div>}
        {report.findings.map(finding => <div className="list-card" key={finding.id} style={{padding:14}}><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span className="badge">{finding.severity}</span><strong>{finding.title}</strong><span className="muted">Line {finding.line}</span></div><p className="muted">{finding.recommendation}</p></div>)}
      </div>}
    </section>}
    {error && <p className="notice" role="alert"><AlertTriangle size={17}/>{error}</p>}
  </div>;
}
