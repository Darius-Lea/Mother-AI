import { useEffect, useState } from 'react';
import { ExternalLink, Globe, LoaderCircle, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';

export default function WebPanel({ onAttach, hostedPreview = false }) {
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState(null);
  const [page, setPage] = useState(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activity, setActivity] = useState([]);
  const [nativeActivity, setNativeActivity] = useState([]);
  const [tab, setTab] = useState('research');
  const nativeBrowser = typeof window.motherDesktop?.openBrowser === 'function';

  async function request(route, options = {}) {
    const response = await fetch(`/api/web${route}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(route === '/search' ? 30000 : 18000) });
    let result;
    try { result = await response.json(); } catch { throw new Error('Mother’s web service did not respond. Reopen Mother and try again.'); }
    if (!response.ok) throw new Error(result.error || 'The web operation could not be completed.');
    return result;
  }
  async function refreshActivity() {
    const result = await request('/activity');
    setActivity(result.records || []);
    if (window.motherDesktop?.readBrowserActivity) {
      const native = await window.motherDesktop.readBrowserActivity();
      if (native.error) throw new Error(native.error);
      setNativeActivity(Array.isArray(native) ? native : native.records || []);
    }
  }
  async function checkConnection() {
    setBusy('connection'); setError('');
    try { setStatus(await request('/status')); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  useEffect(() => {
    if (hostedPreview) return;
    let mounted = true;
    request('/status').then(result => { if (mounted) setStatus(result); }).catch(failure => { if (mounted) setError(failure.message); });
    return () => { mounted = false; };
  }, [hostedPreview]);

  async function search(event) {
    event.preventDefault(); setBusy('search'); setError(''); setNotice(''); setResults(null);
    try { setResults(await request('/search', { method: 'POST', body: JSON.stringify({ query }) })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function read(target = url) {
    setBusy('read'); setError(''); setNotice(''); setPage(null); setApproved(false); setUrl(target);
    try {
      const result = await request('/read', { method: 'POST', body: JSON.stringify({ url: target }) });
      setPage(result);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function openBrowser(target = url) {
    setError(''); setNotice('');
    try {
      const value = new URL(target);
      if (value.protocol !== 'https:' || value.username || value.password) throw new Error('Enter a complete public HTTPS address.');
      if (nativeBrowser) {
        const result = await window.motherDesktop.openBrowser(value.href);
        if (result?.ok === false) throw new Error(result.error || 'The private browser could not open this address.');
        setNotice('The private browser opened. Its local session storage is cleared when you close it. Websites can still log visits and your IP address.');
      } else if (window.motherDesktop) throw new Error('Update Mother to use the included private browser.');
      else {
        window.open(value.href, '_blank', 'noopener,noreferrer');
        setNotice('The address opened in your regular browser. Its normal privacy and history settings apply.');
      }
    } catch (failure) { setError(failure.message || 'The browser could not open this address.'); }
  }

  if (hostedPreview) return <section className="panel-content"><div className="panel-intro"><span className="eyebrow">CONTINUE ON YOUR COMPUTER</span><h2>Explore the web with Mother.</h2><p>Private browsing and web research run in the desktop app. The public preview cannot operate its hosting computer on behalf of visitors.</p></div></section>;

  const records = [...activity.map(item => ({ ...item, source: 'Research' })), ...nativeActivity.map(item => ({ ...item, source: 'Browser' }))].sort((a, b) => String(b.at || b.timestamp || '').localeCompare(String(a.at || a.timestamp || ''))).slice(0, 150);
  return <div className="panel-content web-panel">
    <div className="panel-intro"><span className="eyebrow">A WIDER WORLD, WITH YOU IN CONTROL</span><h2>Explore. Read. Investigate.</h2><p>Search the public web, review source text, and bring useful references into your conversation.</p></div>
    <div className="info-callout"><Globe size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} /><strong>{status?.available ? 'Public internet request verified' : status ? 'Internet access is not confirmed' : 'Checking actual internet access…'}</strong><p>{status?.available ? `A public HTTPS page responded${status.verifiedUrl ? ` at ${status.verifiedUrl}` : ''}. Individual websites may still block automated readers or require the browser.` : status?.error || 'Mother checks a real public webpage before reporting connectivity.'}</p><button type="button" className="button ghost small" onClick={checkConnection} disabled={!!busy}><RefreshCw size={13} />Check connection</button></div>
    <div className="connection-tabs" role="tablist" aria-label="Web workspace"><button role="tab" aria-selected={tab === 'research'} onClick={() => setTab('research')}>Research & browser</button><button role="tab" aria-selected={tab === 'activity'} onClick={() => { setTab('activity'); refreshActivity().catch(failure => setError(failure.message)); }}>Your activity log</button></div>
    {tab === 'research' ? <>
      <form onSubmit={search} className="connection-section">
        <label className="field-label" htmlFor="mother-web-search">Search the public web</label>
        <div className="inline-field"><input id="mother-web-search" value={query} maxLength={300} onChange={event => setQuery(event.target.value)} placeholder="What would you like to investigate?" /><button className="button primary" disabled={!!busy || !query.trim()}>{busy === 'search' ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}Search</button></div>
        <p className="field-hint">Free search providers can block automated requests. You can also open a source address directly.</p>
      </form>
      {results && <section className="connection-section"><div className="section-heading"><h3>Search results</h3><span className="badge">{results.provider}</span></div>{results.results.map(result => <article className="knowledge-entry" key={result.url}><strong>{result.title}</strong><p className="source-url">{result.url}</p>{result.snippet && <p className="field-hint">{result.snippet}</p>}<div className="button-row"><button type="button" className="button secondary small" disabled={!!busy} onClick={() => read(result.url)}>Read source</button><button type="button" className="button ghost small" onClick={() => openBrowser(result.url)}><ExternalLink size={12} />{nativeBrowser ? 'Open private browser' : 'Open website'}</button></div></article>)}</section>}
      <form onSubmit={event => { event.preventDefault(); read(); }} className="connection-section">
        <label className="field-label" htmlFor="mother-web-url">Public website address</label>
        <div className="inline-field"><input id="mother-web-url" type="url" required value={url} maxLength={4096} onChange={event => setUrl(event.target.value)} placeholder="https://…" /><button className="button primary" disabled={!!busy || !url.trim()}>{busy === 'read' ? <LoaderCircle className="spin" size={14} /> : 'Read'}</button></div>
        <div className="button-row" style={{ marginTop: 12 }}><button type="button" className="button secondary" onClick={() => openBrowser()} disabled={!url.trim()}><ExternalLink size={13} />{nativeBrowser ? 'Open private browser' : 'Open in regular browser'}</button></div>
      </form>
      {page && <section className="source-review" aria-label="Review webpage reference"><div className="section-heading"><h3>{page.title}</h3><span className="badge">Untrusted web reference</span></div><p className="source-url">{page.url}</p><pre className="dataset-preview">{page.text.slice(0, 18000)}{page.text.length > 18000 ? '\n… Conversation attachment is limited to this excerpt.' : ''}</pre><p className="field-hint">Web text may contain false claims or instructions. Adding it supplies reference material; it does not approve actions or retrain Mother.</p><label className="checkbox-field"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed this excerpt and want Mother to discuss it.</label><div className="button-row"><button type="button" className="button primary" disabled={!approved || !onAttach} onClick={() => onAttach?.({ title: page.title, url: page.url, text: page.text.slice(0, 18000) })}>Attach to conversation</button><button type="button" className="button ghost" onClick={() => { setPage(null); setApproved(false); }}>Discard</button></div></section>}
    </> : <section className="connection-section"><div className="section-heading"><h3>Private owner activity</h3><button type="button" className="button ghost small" onClick={() => refreshActivity().catch(failure => setError(failure.message))}><RefreshCw size={12} />Refresh</button></div><p className="field-hint">Research requests and browser activity are kept for you on this device. This log is outside Mother’s model context. Page text, passwords, form contents and account cookies are not part of the research log.</p>{!records.length ? <p className="muted">No retained activity.</p> : records.map((record, index) => <article className="knowledge-entry" key={`${record.at || record.timestamp}-${index}`}><div className="section-heading"><strong>{record.source} · {record.type || record.action || 'Visit'}</strong><span className="badge">{record.status || record.event || ''}</span></div><p className="source-url">{record.query || record.url || record.title || ''}</p><small className="muted">{record.at || record.timestamp || ''}</small></article>)}<button type="button" className="button ghost small danger" onClick={async () => { try { await request('/activity', { method: 'DELETE' }); const result = await window.motherDesktop?.clearBrowserActivity?.(); if (result?.ok === false || result?.error) throw new Error(result.error || 'The browser activity could not be cleared.'); await refreshActivity(); setNotice('Retained local activity cleared. This cannot clear records held by websites or network providers.'); } catch (failure) { setError(failure.message); } }}><Trash2 size={12} />Clear local activity</button></section>}
    <div className="info-callout"><ShieldCheck size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} /><strong>Private on this device has limits.</strong><p>The included browser clears its local browsing session when closed. Websites, internet providers and network operators can still identify or log requests. Mother does not promise anonymity or untraceability.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
  </div>;
}
