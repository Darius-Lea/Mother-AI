import { useEffect, useState } from 'react';
import { Download, Monitor, Smartphone, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { normalizeInstaller, installerArchitectures } from '../lib/downloads.js';

function detectPlatform() {
  const userAgent = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'mobile';
  const platform = navigator.userAgentData?.platform || navigator.platform || userAgent;
  if (/Win/i.test(platform)) return 'windows';
  if (/Mac/i.test(platform)) return 'mac';
  return 'linux';
}

function detectArchitecture() {
  if (/arm|aarch64/i.test(`${navigator.platform} ${navigator.userAgent}`)) return 'arm64';
  return detectPlatform() === 'mac' ? 'arm64' : 'x64';
}

function formatSize(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

const platformNames = { windows: 'Windows', mac: 'Mac', linux: 'Linux', mobile: 'Phone or tablet' };
const architectureNames = {
  windows: { x64: 'Most Windows PCs (Intel or AMD)', arm64: 'Windows on ARM' },
  mac: { arm64: 'Apple silicon (M1 or newer)', x64: 'Intel Mac' },
  linux: { x64: 'Intel or AMD, 64-bit' },
};

export default function DownloadPanel({ canInstall = false, onInstall, isDesktop = false }) {
  const [platform, setPlatform] = useState(detectPlatform);
  const [architecture, setArchitecture] = useState(detectArchitecture);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState('');

  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/distribution', { cache: 'no-store' });
      if (!response.ok) throw new Error('Downloads are temporarily unavailable. Please try again.');
      const result = await response.json();
      if (!result || !Array.isArray(result.artifacts)) throw new Error('Downloads are temporarily unavailable. Please try again.');
      setManifest(result);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    refresh();
    let mounted = true;
    navigator.userAgentData?.getHighEntropyValues?.(['architecture']).then(values => {
      if (mounted && /^(arm|x86)$/i.test(values.architecture || '')) setArchitecture(values.architecture.toLowerCase() === 'arm' ? 'arm64' : 'x64');
    }).catch(()=>{});
    return () => { mounted = false; };
  }, []);

  const selectedArchitecture = platform === 'linux' ? 'x64' : architecture;
  const artifacts = (manifest?.artifacts || []).map(item=>normalizeInstaller(item,{version:manifest.version})).filter(Boolean);
  const installer = artifacts.find(item=>item.platform === platform && item.architecture === selectedArchitecture);
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return <div className="panel-content download-panel">
    <div className="panel-intro">
      <span className="eyebrow">MOTHER, MADE SIMPLE</span>
      <h2>A familiar place. On your device.</h2>
      <p>Download Mother, open the installer, and let setup guide you.</p>
    </div>
    {isDesktop && <div className="info-callout"><CheckCircle2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>You are already using the Mother desktop app.</div>}
    <label className="field-label" htmlFor="download-platform">Your device</label>
    <select id="download-platform" value={platform} onChange={(event) => setPlatform(event.target.value)} style={{width:'100%'}}>
      {Object.entries(platformNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    {platform === 'mobile' ? <section className="connection-section">
      <div className="section-heading"><h3><Smartphone size={16} style={{verticalAlign:'middle',marginRight:7}}/>Install on a phone or tablet</h3><span className="badge">Web app</span></div>
      <p>Add Mother to your home screen with your browser’s installation confirmation.</p>
      {canInstall && onInstall ? <div className="button-row"><button type="button" className="button primary" onClick={async()=>{setInstallError('');try{await onInstall();}catch{setInstallError('The browser did not complete installation. You can use its installation menu instead.');}}}><Download size={14}/>Install Mother</button></div> : <div className="source-review">
        <h3>{isIOS ? 'On iPhone and iPad' : 'On Android and other supported browsers'}</h3>
        <ol style={{paddingLeft:18,color:'#91a8b7',fontSize:12,lineHeight:1.9,marginBottom:0}}>
          <li>Open your Mother website in {isIOS ? 'Safari' : 'a supported browser'}.</li>
          <li>{isIOS ? 'Tap Share, then Add to Home Screen.' : 'Open the browser menu and choose Install app or Add to Home screen.'}</li>
          <li>Confirm, then open Mother from its new icon.</li>
        </ol>
      </div>}
      {installError && <p className="error-message" role="alert">{installError}</p>}
      <div className="info-callout"><strong>A connected companion.</strong><p>The browser preview includes Mother’s presence, offline guide, and local memory. Local neural conversations and computer controls are available in the desktop app after model setup.</p></div>
      <p className="field-hint">This web address can be added to your home screen when served over HTTPS. Native App Store and Play Store downloads are not available yet.</p>
    </section> : <section className="connection-section">
      <div className="section-heading"><h3><Monitor size={16} style={{verticalAlign:'middle',marginRight:7}}/>{platformNames[platform]} download</h3><button className="button ghost small" type="button" onClick={refresh} disabled={busy}><RefreshCw size={12}/>{busy?'Checking…':'Refresh'}</button></div>
      {installerArchitectures(platform).length > 1 && <><label className="field-label" htmlFor="download-architecture">Computer type</label><select id="download-architecture" value={architecture} onChange={event=>setArchitecture(event.target.value)} style={{width:'100%'}}>{installerArchitectures(platform).map(value=><option value={value} key={value}>{architectureNames[platform][value]}</option>)}</select></>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {!error && !manifest && <p role="status" className="muted">Checking available installers…</p>}
      {manifest && !installer && <div className="source-review" role="status">
        <span className="badge">Preview download pending</span>
        <h3 style={{marginTop:12}}>Your installer is being prepared.</h3>
        <p>The {platformNames[platform]} installer for this computer type is not available yet. Refresh here after the build finishes.</p>
      </div>}
      {installer && <article className="source-review" style={{marginTop:14}}>
        <div className="section-heading"><h3>Mother for {platformNames[platform]}</h3><span className="badge">First-release preview</span></div>
        <p>Mother {installer.version} · {formatSize(installer.size)}</p>
        <div className="button-row"><a className="button primary" href={installer.downloadUrl} download style={{textDecoration:'none'}}><Download size={14}/>Download Mother for {platformNames[platform]}</a></div>
        <ol className="download-install-steps" style={{paddingLeft:18,fontSize:12,lineHeight:1.9}}>
          <li>Click Download Mother.</li>
          <li>Open the downloaded installer and approve your device’s installation prompt.</li>
          <li>{platform === 'windows' ? 'Mother installs automatically and opens for setup.' : platform === 'mac' ? 'Follow the familiar Mac installer, then open Mother from Applications.' : 'Use your system’s package installer, then open Mother from your apps.'}</li>
        </ol>
        {platform === 'linux' && <p className="field-hint">For Ubuntu, Debian, and compatible systems with a graphical package installer.</p>}
        <p className="field-hint">These preview installers are unsigned. Your operating system may display a warning. Native installation testing is still in progress.</p>
        <details className="setup-details"><summary>Download integrity</summary><p><ShieldCheck size={12} style={{verticalAlign:'middle',marginRight:5}}/>SHA-256</p><code style={{fontSize:9,overflowWrap:'anywhere',lineHeight:1.7,display:'block'}}>{installer.sha256}</code></details>
      </article>}
      <div className="info-callout"><strong>Your first conversation starts with guided setup.</strong><p>Mother includes her local AI engine. Choose a free model in the app; its first download needs internet and disk space. After setup, local conversations can run offline.</p></div>
      <p className="field-hint">First-release preview. Your device controls installation approval.</p>
    </section>}
  </div>;
}
