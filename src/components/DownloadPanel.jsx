import { useEffect, useState } from 'react';
import { Download, Monitor, Smartphone, CheckCircle2, Package, RefreshCw, ShieldCheck } from 'lucide-react';

function detectPlatform() {
  const userAgent = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'mobile';
  const platform = navigator.userAgentData?.platform || navigator.platform || userAgent;
  if (/Win/i.test(platform)) return 'windows';
  if (/Mac/i.test(platform)) return 'mac';
  return 'linux';
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

const platformNames = { windows: 'Windows', mac: 'Mac', linux: 'Linux', mobile: 'Phone or tablet' };
const formatNames = { exe: 'Setup wizard', dmg: 'Mac disk image', deb: 'Package installer', appimage: 'Portable desktop app' };

export default function DownloadPanel({ canInstall = false, onInstall, isDesktop = false }) {
  const [platform, setPlatform] = useState(detectPlatform);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState('');

  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/distribution', { cache: 'no-store' });
      if (!response.ok) throw new Error('The download catalog is unavailable. Try again when this Mother server is online.');
      const result = await response.json();
      if (!result || !Array.isArray(result.artifacts)) throw new Error('The download catalog could not be read.');
      setManifest(result);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => { refresh(); }, []);

  const artifacts = (manifest?.artifacts || []).filter((artifact) => artifact.platform === platform && artifact.filename && artifact.downloadUrl?.startsWith('/downloads/') && /^[a-f0-9]{64}$/i.test(artifact.sha256 || '') && artifact.size > 0);
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return <div className="panel-content download-panel">
    <div className="panel-intro">
      <span className="eyebrow">MOTHER, MADE SIMPLE</span>
      <h2>A familiar place. On your device.</h2>
      <p>Choose your device. Desktop installers include the app and its runtime, so ordinary users do not need a terminal or a source-code folder.</p>
    </div>
    {isDesktop && <div className="info-callout"><CheckCircle2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>You are already using the Mother desktop app.</div>}
    <label className="field-label" htmlFor="download-platform">Your device</label>
    <select id="download-platform" value={platform} onChange={(event) => setPlatform(event.target.value)} style={{width:'100%'}}>
      {Object.entries(platformNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    {platform === 'mobile' ? <section className="connection-section">
      <div className="section-heading"><h3><Smartphone size={16} style={{verticalAlign:'middle',marginRight:7}}/>Install on a phone or tablet</h3><span className="badge">Web app</span></div>
      <p>Mother can be added to a supported browser’s home screen. Your device keeps control of the installation confirmation.</p>
      {canInstall && onInstall ? <div className="button-row"><button type="button" className="button primary" onClick={async()=>{setInstallError('');try{await onInstall();}catch{setInstallError('The browser did not complete installation. You can use its installation menu instead.');}}}><Download size={14}/>Install Mother</button></div> : <div className="source-review">
        <h3>{isIOS ? 'On iPhone and iPad' : 'On Android and other supported browsers'}</h3>
        <ol style={{paddingLeft:18,color:'#91a8b7',fontSize:12,lineHeight:1.9,marginBottom:0}}>
          <li>Open your hosted Mother address in {isIOS ? 'Safari' : 'a supported browser'}.</li>
          <li>{isIOS ? 'Tap Share, then Add to Home Screen.' : 'Open the browser menu and choose Install app or Add to Home screen.'}</li>
          <li>Confirm with your device, then open Mother from its new icon.</li>
        </ol>
      </div>}
      {installError && <p className="error-message" role="alert">{installError}</p>}
      <div className="info-callout"><strong>A connected companion.</strong><p>Installation needs a reachable HTTPS Mother site or localhost and browser support. After its first visit, the cached interface and offline guide can work without a connection. Neural conversations and app connections still need a reachable Mother server with a model. This is not a bundled native iOS or Android neural runtime.</p></div>
      <p className="field-hint">There is no public hosted mobile address or App Store / Play Store release included in this development build. Hosting and secure pairing are separate deployment work.</p>
    </section> : <section className="connection-section">
      <div className="section-heading"><h3><Monitor size={16} style={{verticalAlign:'middle',marginRight:7}}/>{platformNames[platform]} downloads</h3><button className="button ghost small" type="button" onClick={refresh} disabled={busy}><RefreshCw size={12}/>{busy?'Checking…':'Refresh'}</button></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {!error && !manifest && <p role="status" className="muted">Checking available installers…</p>}
      {manifest && !artifacts.length && <div className="source-review">
        <span className="badge">Build pending</span>
        <h3 style={{marginTop:12}}>No {platformNames[platform]} installer is available here yet.</h3>
        <p>Mother only offers downloads after the actual package exists. A source archive is not an ordinary app installer.</p>
      </div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}}>
        {artifacts.map((artifact) => <article className="source-review" key={artifact.filename} style={{marginTop:14}}>
          <div className="section-heading"><h3><Package size={16} style={{verticalAlign:'middle',marginRight:7}}/>{formatNames[artifact.format] || artifact.format}</h3><span className="badge">{artifact.architecture}</span></div>
          <p>Mother {artifact.version || manifest.version} · {formatSize(artifact.size)}</p>
          <div className="button-row"><a className="button primary" href={artifact.downloadUrl} download style={{textDecoration:'none'}}><Download size={14}/>Download for {platformNames[platform]}</a></div>
          <p className="field-hint">{artifact.format === 'exe' ? 'Open the downloaded setup file and follow the wizard.' : artifact.format === 'dmg' ? 'Open the disk image and move Mother into Applications.' : artifact.format === 'deb' ? 'Open with your distribution’s package installer.' : 'A portable Linux application. Desktop launch support varies by distribution.'}</p>
          <details className="setup-details"><summary>Package integrity and signing</summary><p><ShieldCheck size={12} style={{verticalAlign:'middle',marginRight:5}}/>{artifact.signing === 'signed' ? 'Signed package.' : 'Unsigned development package. Your operating system may display a warning. A signed production release is separate work.'}</p><p>SHA-256</p><code style={{fontSize:9,overflowWrap:'anywhere',lineHeight:1.7,display:'block'}}>{artifact.sha256}</code></details>
        </article>)}
      </div>
      <div className="info-callout"><strong>One guided setup after installation.</strong><p>Mother checks for the local AI runtime and helps you choose and download a model for your hardware. Model downloads need internet and disk space. If the runtime is missing, its official installer still needs your operating system’s confirmation.</p></div>
      <p className="field-hint">Packaged application files are kept out of the normal user workflow. Packaging is not a guarantee that software can never be inspected by its owner.</p>
    </section>}
  </div>;
}
