import {useEffect,useState} from 'react';
import {ShieldCheck,RefreshCw,Terminal,Play,Check,AlertTriangle,Server} from 'lucide-react';

async function securityRequest(endpoint,body){
  const response=await fetch(`/api/security${endpoint}`,body===undefined?{signal:AbortSignal.timeout(20000)}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The security tool request could not be completed.');return data;
}

export default function KaliPanel(){
  const [inventory,setInventory]=useState(null),[target,setTarget]=useState(''),[authorized,setAuthorized]=useState(false),[plan,setPlan]=useState(null),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const available=inventory?.capabilities?.singleHostTcpCheck===true;
  async function refresh(){setBusy(true);setError('');try{setInventory(await securityRequest('/capabilities?refresh=true'));}catch(failure){setError(failure.message);}finally{setBusy(false);}}
  useEffect(()=>{let active=true;securityRequest('/capabilities').then(data=>{if(active)setInventory(data);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[]);
  async function prepare(event){event.preventDefault();setBusy(true);setError('');setResult(null);setPlan(null);try{setPlan(await securityRequest('/plan',{tool:'nmap',target:target.trim(),authorizationConfirmed:authorized}));}catch(failure){setError(failure.message);}finally{setBusy(false);}}
  async function run(){if(!plan||!authorized)return;setBusy(true);setError('');try{setResult(await securityRequest(`/plans/${encodeURIComponent(plan.id)}/run`,{approved:true}));setPlan(null);}catch(failure){setError(failure.message);setPlan(null);}finally{setBusy(false);}}
  return <div className="panel-content kali-panel">
    <div className="panel-intro"><span className="eyebrow">REAL TOOLS. EXPLICIT PERMISSION.</span><h2>A bridge to your security tools.</h2><p>Mother can detect supported tools on her server computer and run one reviewed, authorized Nmap host check.</p></div>
    <div className="info-callout"><strong><ShieldCheck size={13}/> A limited bridge, not the full Kali suite.</strong><p>Kali Linux and its entire tool collection are not bundled. Phones and tablets use tools running on a compatible host; they do not gain desktop security tools by installing this interface.</p></div>
    <section className="connection-section">
      <div className="section-heading"><h3><Server size={14}/> Tools on the Mother host</h3><button className="button ghost small" type="button" disabled={busy} onClick={refresh}><RefreshCw size={12}/>Refresh tools</button></div>
      {!inventory&&!error&&<p className="muted" role="status">Checking installed tool versions…</p>}
      {inventory?.tools.map(tool=><article className="knowledge-entry" key={tool.id}>
        <div className="section-heading"><strong>{tool.label}</strong><span className={`badge ${tool.installed?'connected':''}`}>{tool.installed?'Version detected':'Unavailable'}</span></div>
        <p>{tool.installed?tool.version:'Not installed or its version check did not complete.'}</p>
        {tool.id!=='nmap'&&<p className="field-hint">Inventory only. Mother does not execute this tool’s security operations.</p>}
      </article>)}
      <p className="field-hint">Version detection checks the computer hosting Mother. Mother does not install tools, elevate privileges, or run a background network scan.</p>
    </section>
    <section className="connection-section">
      <div className="section-heading"><h3>Single-host TCP check</h3><span className="badge">Nmap</span></div>
      <p>This profile checks the 20 most common TCP ports on one host. It does not exploit services, sweep a network, or prove that a system is secure.</p>
      {!available&&inventory&&<div className="notice" style={{marginTop:14}}>Nmap is unavailable on this host. An administrator can install it from a trusted package source or maintain a separate Kali environment. No scan can run until the actual tool is available.</div>}
      <form onSubmit={prepare}>
        <label className="field-label" htmlFor="security-target">Host you are authorized to test</label>
        <input id="security-target" className="text-input" placeholder="owned-host.example or one IP address" value={target} maxLength={253} disabled={busy} autoComplete="off" spellCheck={false} onChange={event=>{setTarget(event.target.value);setPlan(null);setAuthorized(false);}}/>
        <p className="field-hint">One hostname or IP address. Network ranges, URLs, target lists, command flags, and shell syntax are rejected.</p>
        <label className="checkbox-field"><input type="checkbox" checked={authorized} disabled={busy} onChange={event=>{setAuthorized(event.target.checked);if(!event.target.checked)setPlan(null);}}/>I own this host or have explicit permission to run this check.</label>
        <div className="button-row"><button type="submit" className="button secondary" disabled={!available||busy||!target.trim()||!authorized}><Terminal size={14}/> Review check plan</button></div>
      </form>
      {plan&&<section className="source-review" aria-label="Review security check plan">
        <div className="section-heading"><h3>Approve this exact check</h3><span className="badge">One use</span></div>
        <p><strong>Target:</strong> {plan.target}</p><p>{plan.description}</p>
        <pre style={{fontSize:10}}>nmap {plan.args.join(' ')}</pre>
        <p className="field-hint">The fixed arguments are passed without a shell. This plan expires in five minutes and can run once. A check can create network traffic and appear in the target’s logs.</p>
        <div className="button-row"><button className="button primary" type="button" disabled={busy||!authorized} onClick={run}><Play size={13}/>{busy?'Running the approved check…':'Run approved check'}</button><button className="button ghost" type="button" disabled={busy} onClick={()=>setPlan(null)}>Discard plan</button></div>
      </section>}
      {busy&&plan&&<p className="field-hint" role="status">Waiting for actual Nmap output. Execution is bounded to 45 seconds.</p>}
      {result&&<section className="source-review" aria-label="Actual security tool result">
        <div className="section-heading"><h3>{result.state==='completed'?<><Check size={14}/> Check finished</>:<><AlertTriangle size={14}/> Check did not complete</>}</h3><span className="badge">{result.target}</span></div>
        <p className="field-hint">Exit status: {result.exitCode===null?'unavailable':result.exitCode}{result.signal?` · signal ${result.signal}`:''}{result.timedOut?' · timeout':''}{result.truncated?' · output limited':''}</p>
        {result.error&&<p className="error-message" role="alert">{result.error}</p>}
        <pre className="dataset-preview" style={{maxHeight:350}}>{result.stdout||'(No standard output)'}{result.stderr?`\n\nStandard error:\n${result.stderr}`:''}</pre>
        <p className="field-hint">{result.limitation}</p>
      </section>}
    </section>
    {error&&<p className="error-message" role="alert">{error}</p>}
  </div>;
}
