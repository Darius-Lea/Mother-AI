import {useEffect,useState} from 'react';
import {Code2,FolderOpen,FileCode2,RefreshCw,ArrowUpRight,Check,RotateCcw,ShieldCheck} from 'lucide-react';

async function request(endpoint,body) {
  const response=await fetch(`/api/workspace${endpoint}`,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'The project operation could not be completed.');return data;
}
export default function CodeWorkspace({model,onAsk}) {
  const [project,setProject]=useState(null),[directory,setDirectory]=useState(''),[files,setFiles]=useState([]),[truncated,setTruncated]=useState(false);
  const [file,setFile]=useState(null),[draft,setDraft]=useState(''),[instruction,setInstruction]=useState('Explain this file and suggest useful improvements.'),[proposal,setProposal]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function action(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function loadTree(){const data=await request('/tree');setProject(data);setFiles(data.files);setTruncated(data.truncated);}
  useEffect(()=>{let active=true;request('/status').then(async data=>{if(active){setProject(data);if(data.open)await loadTree();}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function openProject(selected){await request('/open',{path:selected});setFile(null);setDraft('');setProposal(null);await loadTree();setNotice('Project connected. Files are read only until you review and approve a change.');}
  async function chooseProject(){await action(async()=>{
    const selected=await window.motherDesktop?.chooseProjectDirectory?.();
    const selectedPath=typeof selected==='string'?selected:(!selected?.canceled && typeof selected?.path==='string'?selected.path:null);
    if(selectedPath)await openProject(selectedPath);
  });}
  async function openFile(relative){await action(async()=>{const data=await request(`/file?path=${encodeURIComponent(relative)}`);setFile(data);setDraft(data.content);setProposal(null);});}
  return <div className="panel-content code-workspace">
    <div className="panel-intro"><span className="eyebrow">CREATE WITH CONFIDENCE</span><h2>Your code. A capable companion.</h2><p>Connect a project, explore a file with your local model, and review every edit before it reaches disk.</p></div>
    <div className="info-callout"><strong><ShieldCheck size={13}/> You approve the changes.</strong><p>Mother can read supported files in the folder you select. She does not run commands, install dependencies, or apply generated code automatically.</p></div>
    <section className="connection-section">
      <div className="section-heading"><h3>Project folder</h3><span className={`badge ${project?.open?'connected':''}`}>{project?.open?'Connected':'Not connected'}</span></div>
      {window.motherDesktop?.chooseProjectDirectory ? <button className="button primary" onClick={chooseProject} disabled={busy}><FolderOpen size={14}/> Choose project folder</button> : <form onSubmit={event=>{event.preventDefault();action(()=>openProject(directory));}}>
        <label className="field-label" htmlFor="project-directory">Folder on the computer running Mother</label>
        <div className="inline-field"><input id="project-directory" value={directory} onChange={e=>setDirectory(e.target.value)} placeholder="/path/to/your/project" required/><button className="button primary" disabled={busy || !directory.trim()}>Open project</button></div>
        <p className="field-hint">The desktop app offers a folder picker. In a browser, this path belongs to Mother's server, not a remote phone.</p>
      </form>}
      {project?.open && <><p className="field-hint" style={{overflowWrap:'anywhere'}}>{project.name} · {project.path}</p><div className="button-row"><button className="button secondary small" disabled={busy} onClick={()=>action(loadTree)}><RefreshCw size={12}/> Refresh files</button><button className="button ghost small" disabled={busy} onClick={()=>action(async()=>{setProject(await request('/close',{}));setFiles([]);setFile(null);setProposal(null);})}>Disconnect project</button></div></>}
    </section>
    {error && <p role="alert" className="error-message">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    {project?.open && <section className="connection-section">
      <div className="section-heading"><h3>Source files</h3><span className="badge">{files.length} files</span></div>
      <p className="field-hint">Common secret file names, dependency folders, symbolic links, hard links, binary files, and files over 128 KB are excluded. {truncated?'Listing limited to keep the workspace responsive.':''}</p>
      <div className="project-file-list" style={{maxHeight:160,overflow:'auto',border:'1px solid #ffffff12',borderRadius:7,padding:5,marginTop:12}}>
        {!files.length && <p className="muted" style={{padding:12}}>No supported source files were found.</p>}
        {files.map(entry=><button key={entry.path} className={`button ghost small ${file?.path===entry.path?'selected':''}`} disabled={busy} onClick={()=>openFile(entry.path)} style={{display:'flex',width:'100%',justifyContent:'flex-start',textAlign:'left',overflowWrap:'anywhere',background:file?.path===entry.path?'#9de2e514':undefined}}><FileCode2 size={12}/>{entry.path}</button>)}
      </div>
    </section>}
    {file && <section className="connection-section">
      <div className="section-heading"><h3 style={{overflowWrap:'anywhere'}}>{file.path}</h3><span className="badge">{file.bytes.toLocaleString()} bytes</span></div>
      <label className="field-label" htmlFor="code-instruction">Ask Mother about this file</label>
      <textarea id="code-instruction" className="textarea" rows={3} value={instruction} onChange={e=>setInstruction(e.target.value)} maxLength={4000}/>
      <div className="button-row"><button className="button secondary" disabled={!model || !onAsk || !instruction.trim() || busy} onClick={()=>onAsk({path:file.path,content:file.content,prompt:instruction})}><Code2 size={13}/> Discuss this file <ArrowUpRight size={12}/></button></div>
      <p className="field-hint">{model?`Uses ${model}. The selected file is included as reference in your conversation.`:'Connect a local model to enable AI code discussion. The editor and change review work independently.'}</p>
      <label className="field-label" htmlFor="code-draft">Proposed file contents</label>
      <textarea id="code-draft" className="textarea" rows={15} value={draft} onChange={e=>{setDraft(e.target.value);setProposal(null);}} disabled={busy} style={{fontFamily:'ui-monospace,monospace',fontSize:11,lineHeight:1.65,minHeight:250}} spellCheck={false}/>
      <div className="button-row"><button className="button primary" disabled={busy || draft===file.content} onClick={()=>action(async()=>{setProposal(await request('/proposals',{path:file.path,content:draft,expectedSha256:file.sha256}));})}>Review change</button><button className="button ghost" disabled={busy || draft===file.content} onClick={()=>{setDraft(file.content);setProposal(null);}}>Discard draft</button></div>
      {proposal && <div className="source-review" aria-label="Review proposed file change">
        <div className="section-heading"><h3>{proposal.status==='pending'?'Review before applying':proposal.status==='applied'?'Change applied':'Original restored'}</h3><span className="badge">{proposal.status}</span></div>
        <pre className="dataset-preview" style={{maxHeight:350}}>{proposal.diff.text}</pre>
        <p className="field-hint">{proposal.diff.removedLines} removed lines · {proposal.diff.addedLines} added lines. {proposal.diff.truncated?'The preview is shortened; review the complete contents above.':''} No tests or commands are run by this tool.</p>
        {proposal.status==='pending' && <div className="button-row"><button className="button primary" disabled={busy} onClick={()=>action(async()=>{
          const result=await request(`/proposals/${proposal.id}/apply`,{});setProposal(result);const updated=await request(`/file?path=${encodeURIComponent(file.path)}`);setFile(updated);setDraft(updated.content);setNotice('Approved change written. You can restore the original during this session if no other edit intervenes.');
        })}><Check size={13}/> Apply approved change</button><button className="button ghost" disabled={busy} onClick={()=>setProposal(null)}>Cancel review</button></div>}
        {proposal.status==='applied' && <div className="button-row"><button className="button secondary" disabled={busy} onClick={()=>action(async()=>{
          const result=await request(`/proposals/${proposal.id}/rollback`,{});setProposal(result);const restored=await request(`/file?path=${encodeURIComponent(file.path)}`);setFile(restored);setDraft(restored.content);setNotice('Original contents restored.');
        })}><RotateCcw size={13}/> Restore original</button></div>}
        <p className="field-hint">Restore is kept in memory for 30 minutes and is lost when Mother restarts. Keep your own version-control backup.</p>
      </div>}
    </section>}
  </div>;
}
