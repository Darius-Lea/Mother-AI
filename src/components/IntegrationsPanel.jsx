import { useEffect, useState } from 'react';
import { Link2, Copy, Check, ShieldCheck, KeyRound, Trash2, RefreshCw } from 'lucide-react';

const scopeLabels = { chat: 'Conversations & coding with your local model', 'code:review': 'Local code pattern checks' };

export default function IntegrationsPanel() {
  const [connections, setConnections] = useState([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['chat']);
  const [approved, setApproved] = useState(false);
  const [created, setCreated] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  async function refresh() {
    setError('');
    try {
      const [listResponse, infoResponse] = await Promise.all([fetch('/api/integrations'), fetch('/api/integrations/info')]);
      const list = await listResponse.json();
      const details = await infoResponse.json();
      if (!listResponse.ok) throw new Error(list.error || 'Could not read your app connections.');
      if (!infoResponse.ok) throw new Error(details.error || 'Could not discover the local app endpoint.');
      setConnections(list.connections || []);
      setInfo(details);
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function createConnection(event) {
    event.preventDefault();
    if (!approved || !scopes.length || !name.trim()) return;
    setBusy(true); setError(''); setNotice(''); setCopied(false);
    try {
      const response = await fetch('/api/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not grant app access.');
      setCreated(data); setName(''); setApproved(false);
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function revoke(id) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/integrations/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not revoke this connection.');
      if (created?.connection.id === id) setCreated(null);
      setConfirmRevoke(null); setNotice('App access revoked. Its token can no longer start requests.');
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function toggleScope(scope) {
    setScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope]);
    setApproved(false);
  }
  const endpoint = info?.baseUrl || 'http://127.0.0.1:3001';
  const example = `const response = await fetch('${endpoint}/api/connect/${created?.connection.scopes.includes('chat') ? 'chat' : 'review'}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    Authorization: 'Bearer YOUR_APP_TOKEN'\n  },\n  body: JSON.stringify(${created?.connection.scopes.includes('chat') ? "{\n    model: 'YOUR_INSTALLED_MODEL',\n    messages: [{ role: 'user', content: 'Help improve my app.' }]\n  }" : "{ source: 'your source code here' }"})\n});\nconst result = await response.json();`;

  return <div className="panel-content integrations-panel">
    <div className="panel-intro"><span className="eyebrow">MOTHER, IN YOUR APPS</span><h2>Intelligence that connects.</h2><p>Let a compatible app use Mother’s local model or code checks. You choose its permissions and can revoke access at any time.</p></div>
    <div className="info-callout"><strong>For apps with Mother API support.</strong><p>This creates a working local API connection. It does not automatically modify an app or grant access to your accounts. Existing commercial apps need a compatible adapter. A local neural model must be running for AI conversations.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    <form onSubmit={createConnection} className="connection-section">
      <div className="section-heading"><h3>Give an app access</h3><KeyRound size={16}/></div>
      <label htmlFor="integration-name" className="field-label">App name</label>
      <input className="text-input" id="integration-name" value={name} maxLength={80} onChange={event => { setName(event.target.value); setApproved(false); }} placeholder="My writing app" autoComplete="off" required/>
      <span className="field-label">What may this app use?</span>
      {Object.entries(scopeLabels).map(([scope, label]) => <label className="checkbox-field" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)}/>{label}</label>)}
      <label className="checkbox-field"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)}/>I trust this app and approve the selected access.</label>
      <div className="button-row"><button type="submit" className="button primary" disabled={busy || !approved || !scopes.length || !name.trim()}><Link2 size={14}/>{busy ? 'Working…' : 'Create app connection'}</button></div>
      <p className="field-hint">App tokens do not grant file access, shell execution, private memories, account access, or control over devices.</p>
    </form>
    {created && <section className="source-review" aria-label="New app connection token">
      <div className="section-heading"><h3>{created.connection.name} is ready to connect</h3><span className="badge connected">Granted</span></div>
      <p>Copy this access token into the compatible app’s private Mother integration settings. Mother will not display it again after you close this panel.</p>
      <label className="field-label" htmlFor="created-app-token">One-time app token</label>
      <input id="created-app-token" className="text-input" readOnly value={created.token} onFocus={event => event.target.select()} spellCheck={false}/>
      <div className="button-row"><button type="button" className="button secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(created.token); setCopied(true); }
        catch { setError('Clipboard is unavailable. Select and copy the token above.'); }
      }}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy app token'}</button><button type="button" className="button ghost" onClick={() => setCreated(null)}>I have saved it</button></div>
      <p className="field-hint">Anyone with this token can use its granted features on your Mother endpoint. Keep it private; revoke the connection if it is exposed. Do not put it in public browser code.</p>
      <details className="setup-details"><summary>Integration example for app developers</summary><pre>{example}</pre><p>The example uses a placeholder. Supply your private token at runtime. Select an installed model for chat. Code checks are static patterns, not a neural security audit.</p></details>
    </section>}
    <section className="connection-section">
      <div className="section-heading"><h3>App permissions</h3><button className="button ghost small" type="button" onClick={refresh} disabled={busy} aria-label="Refresh app connections"><RefreshCw size={13}/>Refresh</button></div>
      {!connections.length && <div className="empty-state"><ShieldCheck size={22}/><h3>No app access granted.</h3><p>Choose exactly which app you want to connect first.</p></div>}
      {connections.map(connection => <article className="knowledge-entry" key={connection.id}>
        <div className="section-heading"><strong>{connection.name}</strong><span className="badge">{connection.scopes.length} permissions</span></div>
        <p>{connection.scopes.map(scope => scope === 'chat' ? 'Local AI conversation' : 'Code pattern checks').join(' · ')}</p>
        <p className="field-hint">{connection.lastUsedAt ? `Last successful request ${new Date(connection.lastUsedAt).toLocaleString()}` : 'Access granted · no successful requests yet'}</p>
        {confirmRevoke === connection.id ? <div><p>Revoke this app’s access? Existing in-flight requests may finish.</p><div className="button-row"><button type="button" className="button danger" disabled={busy} onClick={() => revoke(connection.id)}>Revoke app access</button><button type="button" className="button ghost" onClick={() => setConfirmRevoke(null)}>Keep connected</button></div></div> : <div className="button-row"><button type="button" className="button ghost small danger" disabled={busy} onClick={() => setConfirmRevoke(connection.id)}><Trash2 size={12}/>Revoke</button></div>}
      </article>)}
    </section>
    {info && <details className="setup-details"><summary>Local connection address</summary><p>Your current Mother API endpoint:</p><pre>{endpoint}/api/connect</pre><p>The desktop app’s port can change on restart. Update the compatible app with the displayed address. Tokens remain valid until revoked. This endpoint stays on this computer; a hosted service cannot reach your localhost without a separately configured bridge.</p></details>}
  </div>;
}
