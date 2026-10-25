import React, { useState, useEffect, useRef } from 'react';
import { Atom, ArrowUpRight, ArrowUp, AudioLines, BookOpen, Boxes, Check, ChevronRight, CircleHelp, Cpu, Download, Expand, Fingerprint, Hand, HardDrive, Headphones, Link2, LoaderCircle, Maximize2, MessageCircle, Mic, MicOff, MoreHorizontal, Orbit, PanelRightClose, Pause, Play, Plus, Power, RotateCcw, Settings2, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, Volume2, VolumeX, WifiOff, X, Code2 } from 'lucide-react';
import MotherScene from './components/MotherScene.jsx';
import KnowledgePanel from './components/KnowledgePanel.jsx';
import ConnectPanel from './components/ConnectPanel.jsx';
import ToolsPanel from './components/ToolsPanel.jsx';
import KaliPanel from './components/KaliPanel.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import IntegrationsPanel from './components/IntegrationsPanel.jsx';
import CodeWorkspace from './components/CodeWorkspace.jsx';
import DownloadPanel from './components/DownloadPanel.jsx';
import { loadMemory, saveMemory, makeId, retrieveContext, getMemoryLoadIssue } from './lib/memory.js';
import { localReply, referenceDocuments } from './lib/guide.js';

const navigation = [
  {id:'home',label:'Sanctuary',icon:Orbit},
  {id:'knowledge',label:'Knowledge',icon:BookOpen},
  {id:'connections',label:'Connections',icon:Boxes},
  {id:'security',label:'Security lab',icon:ShieldCheck},
  {id:'code',label:'Coding studio',icon:Code2},
  {id:'downloads',label:'Get Mother',icon:Download},
];
const descriptions = {
  code: ['From an idea to a working change.', 'Explore a project. Review a change. Keep control.'],
  downloads: ['A familiar presence. Anywhere.', 'Choose your device. Install Mother. Make yourself at home.'],
  knowledge: ['A mind, thoughtfully grown.', 'Review sources. Keep what matters. Teach with intention.'],
  connections: ['Your world, connected.', 'Free local intelligence. Memory that travels with you.'],
  security: ['Built on a foundation of trust.', 'Practical tools. Local processing. You stay in control.'],
};
function DesktopFeature({ title, children, onDownload }) {
  return <section className="desktop-feature"><span className="eyebrow">CONTINUE ON YOUR COMPUTER</span><h2>{title}</h2><p>{children}</p><div className="button-row"><button className="button primary" onClick={onDownload}><Download size={14}/>Get the desktop app</button></div><p className="field-hint">Your preview conversations and approved files stay in this browser. Export your memory to take them with you.</p></section>;
}

const welcome = {id:'welcome',role:'assistant',content:"Hello, I'm Mother.\nA little light. A little possibility.\nA space to think, create, and grow together.\n\nWhere shall we begin?",engine:'Introduction'};

export default function App() {
  const [memory,setMemory] = useState(loadMemory);
  const initialMemory=useRef(memory);
  const loadIssue=useRef(getMemoryLoadIssue());
  const [page,setPage] = useState('home');
  const [connectionTab,setConnectionTab]=useState('model');
  const [securityTab,setSecurityTab]=useState('local');
  const [showSetup,setShowSetup]=useState(()=>!!window.motherDesktop && !memory.settings?.setupVisited);
  const [phase,setPhase] = useState('assembling');
  const [activity,setActivity] = useState('idle');
  const [gesture,setGesture] = useState('welcome');
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [models,setModels] = useState({available:false,models:[]});
  const [voice,setVoice] = useState(false);
  const [recognitionAvailable] = useState(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [focus,setFocus] = useState(false);
  const [installPrompt,setInstallPrompt] = useState(null);
  const [menuOpen,setMenuOpen] = useState(false);
  const endRef = useRef(null);
  const sceneRef = useRef(null);
  const recognition = useRef(null);
  const pending = useRef(null);
  const memoryRef = useRef(memory);
  const messages = memory.conversations?.length ? memory.conversations : [welcome];
  const selectedModel = memory.settings?.model;
  const [deployment,setDeployment] = useState(()=>{
    if(window.motherDesktop)return {mode:'desktop'};
    try {const mode=sessionStorage.getItem('mother-deployment-mode');return ['hosted-preview','local'].includes(mode)?{mode}:null;}catch{return null;}
  });
  const neuralReady = deployment?.mode!=='hosted-preview' && models.available && models.models.some(m => m.name === selectedModel);
  const hostedPreview=deployment?.mode==='hosted-preview';
  const canUse=(capability)=>!!deployment && !hostedPreview && deployment.capabilities?.[capability]!==false;
  const openSetup=()=>{if(!canUse('modelSetup'))setPage('downloads');else setShowSetup(true);};
  const desktopFeature=(title,children)=><DesktopFeature title={title} onDownload={()=>setPage('downloads')}>{children}</DesktopFeature>;

  useEffect(() => {memoryRef.current = memory;if(memory===initialMemory.current && loadIssue.current){setNotice(loadIssue.current);return;}const result=saveMemory(memory);if(!result.ok)setNotice(result.error);}, [memory]);
  useEffect(() => {
    fetch('/api/health').then(r=>{if(!r.ok)throw Error();return r.json();}).then(result=>{setDeployment(result);try{sessionStorage.setItem('mother-deployment-mode',result.mode);}catch{}if(result.mode==='hosted-preview')setShowSetup(false);}).catch(()=>{});
    const refresh = () => fetch('/api/models').then(r=>r.json()).then(setModels).catch(()=>setModels({available:false,models:[]}));
    refresh();const timer=setInterval(refresh,15000); return ()=>clearInterval(timer);
  },[]);
  useEffect(() => {const onInstall=e=>{e.preventDefault();setInstallPrompt(e);}; window.addEventListener('beforeinstallprompt',onInstall); return ()=>window.removeEventListener('beforeinstallprompt',onInstall);},[]);
  useEffect(() => {endRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});}, [messages.length,busy]);
  useEffect(() => () => {pending.current?.abort();recognition.current?.abort();window.speechSynthesis?.cancel();},[]);

  function speak(text) {
    if (!voice || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[`*#]/g,''));
    utterance.rate=.94;utterance.pitch=1.04;
    const voices=window.speechSynthesis.getVoices();
    const preferred=voices.find(v=>v.localService && /^en/i.test(v.lang));
    if(preferred) utterance.voice=preferred;
    utterance.onstart=()=>{setActivity('speaking');setGesture('explain');};
    utterance.onend=utterance.onerror=()=>{setActivity('idle');setGesture('welcome');};
    window.speechSynthesis.speak(utterance);
  }
  async function send(text=input) {
    const trimmed=text.trim();if(!trimmed || busy) return;
    setInput('');setBusy(true);setActivity('thinking');
    window.speechSynthesis?.cancel();
    const current=memoryRef.current;
    const history=[...(current.conversations || []),{id:makeId(),role:'user',content:trimmed,createdAt:new Date().toISOString()}].slice(-100);
    setMemory({...current,conversations:history});
    let reply;let engine='Offline guide';
    const controller=new AbortController();pending.current=controller;
    try {
      if(neuralReady) {
        const context=[current.profile?.name ? `Preferred name: ${current.profile.name}` : '',retrieveContext(trimmed,referenceDocuments(current))].filter(Boolean).join('\n\n');
        const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selectedModel,messages:history.filter(m=>['user','assistant'].includes(m.role)).slice(-16).map(({role,content})=>({role,content:content.slice(0,16000)})),context}),signal:controller.signal});
        const result=await response.json();if(!response.ok) throw Error(result.error || 'Local model could not respond.');
        reply=result.message?.content;if(!reply) throw Error('The model returned an empty response.');engine=selectedModel;
      } else {
        await new Promise(resolve=>setTimeout(resolve,380));
        if(controller.signal.aborted) throw new DOMException('Cancelled','AbortError');
        reply=localReply(trimmed,current);
      }
      setMemory(latest=>({...latest,conversations:[...history,{id:makeId(),role:'assistant',content:reply,engine,createdAt:new Date().toISOString()}]}));
      setActivity('idle');speak(reply);
    } catch(error) {
      if(error.name!=='AbortError') setNotice(`${error.message} Your message is saved; check Connections and try again.`);
      setActivity('idle');
    } finally {setBusy(false);pending.current=null;}
  }
  function toggleListening() {
    if(activity==='listening') {recognition.current?.stop();setActivity('idle');return;}
    if(!recognitionAvailable) {setNotice('Speech recognition is not available in this browser. You can always type to Mother.');return;}
    const SR=window.SpeechRecognition || window.webkitSpeechRecognition;
    const r=new SR();r.lang='en-US';r.interimResults=true;r.continuous=false;
    r.onresult=e=>{const transcript=Array.from(e.results).map(result=>result[0].transcript).join(' ');setInput(transcript);};
    r.onend=()=>setActivity('idle');
    r.onerror=e=>{setActivity('idle');setNotice(e.error==='not-allowed'?'Microphone permission was not granted. You can type instead.':`Speech recognition: ${e.error}. You can type instead.`);};
    recognition.current=r;try {r.start();setActivity('listening');} catch {setActivity('idle');setNotice('Could not start the microphone.');}
  }
  function feedback(message,rating) {
    setMemory(current=>({...current,feedback:[...(current.feedback || []).filter(f=>f.messageId!==message.id),{id:makeId(),messageId:message.id,rating,prompt:messages[messages.indexOf(message)-1]?.content || '',response:message.content,engine:message.engine || '',createdAt:new Date().toISOString()}]}));
    setNotice('Feedback saved locally. This helps you curate future training examples; it does not change model weights.');
  }
  function wave() {setGesture('wave');setTimeout(()=>setGesture('welcome'),4000);}
  function togglePower() {if(phase==='dormant')setPhase('assembling');else {setPhase('dormant');window.speechSynthesis?.cancel();setActivity('idle');}}
  function replay() {setPhase('dormant');setTimeout(()=>setPhase('assembling'),450);}

  return <div className={`app-shell ${focus?'focus-mode':''} ${hostedPreview?'hosted-preview':''}`}>
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Mother AI home" onClick={e=>{e.preventDefault();setPage('home');}}><span className="brand-mark"><Atom size={28} strokeWidth={1.2}/></span><span>MOTHER<span className="brand-ai">AI</span></span></a>
      <div className="workspace-label">YOUR PERSONAL UNIVERSE</div>
      <nav aria-label="Main navigation">{navigation.map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${page===id?'active':''}`} onClick={()=>setPage(id)}><Icon size={18}/><span>{label}</span>{page===id && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-note"><span className="tiny-label">A DIFFERENT KIND OF AI</span><p>Yours to shape.<br/>Yours to keep.</p><span className="note-orbit"><Orbit size={58} strokeWidth={.6}/></span></div>
      <div className="sidebar-bottom"><div className="local-indicator"><span className="status-dot"/> LOCAL-FIRST BY DESIGN</div><button className="profile-button" onClick={()=>setPage('connections')}><span className="profile-avatar">Y</span><span>Your space<small>Personal workspace</small></span><Settings2 size={15}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Your workspace <ChevronRight size={13}/><span>{navigation.find(n=>n.id===page)?.label}</span></div><div className="topbar-right"><span className="private-tag"><ShieldCheck size={13}/> Private by default</span><button className="icon-btn help-button" aria-label="About Mother" onClick={()=>setNotice('Mother is a local-first workspace. The 3D body is a visual simulation. Local neural conversation requires Ollama; the offline guide is clearly labeled. Your browser stores memory until you export it.')}><CircleHelp size={17}/></button><span className="version-tag">FIRST RELEASE <span>PREVIEW</span></span></div></header>
      <main>
        <section className="page-heading"><div><div className="eyebrow"><span/> INTELLIGENCE WITH A PRESENCE</div><h1>{page==='home'?<>Meet Mother<span className="heading-period">.</span></>:descriptions[page][0]}</h1><p>{page==='home'?'A mind to explore with. A presence that grows with you.':descriptions[page][1]}</p></div><button className={`mode-chip ${neuralReady?'connected':''}`} onClick={()=>hostedPreview?setPage('downloads'):neuralReady?setPage('connections'):openSetup()}><span className="status-dot"/><span>{hostedPreview?'HOSTED PREVIEW':neuralReady?'LOCAL NEURAL MODEL':'OFFLINE GUIDE'}<small>{hostedPreview?'Get the desktop app':neuralReady?selectedModel:'Start guided setup'}</small></span><ArrowUpRight size={15}/></button></section>
        {hostedPreview && <section className="preview-banner" aria-label="Hosted preview"><span><strong>Explore Mother in your browser.</strong><small>This preview includes her 3D presence, offline guide, and local memory. Use the desktop app for a neural model, project editing, and app connections.</small></span><button className="button secondary" onClick={()=>setPage('downloads')}><Download size={13}/>Get desktop app</button></section>}
        {notice && <div className="toast" role="status"><CircleHelp size={16}/><span>{notice}</span><button aria-label="Dismiss notification" className="icon-btn" onClick={()=>setNotice('')}><X size={15}/></button></div>}
        <div className={`workspace-grid ${page!=='home'?'panel-open':''}`}>
          <section className="presence-card" aria-label="Mother 3D presence" ref={sceneRef}>
            <div className="presence-top"><div><span className={`status-dot ${phase==='dormant'?'dim':''}`}/><span>{phase==='dormant'?'AT REST':phase==='assembling'?'BECOMING MOTHER':activity==='idle'?'MOTHER IS HERE':`MOTHER IS ${activity.toUpperCase()}`}</span></div><span className="render-label">LIVE / 3D</span></div>
            <div className="scene-container"><MotherScene phase={phase} activity={activity} gesture={gesture} reducedMotion={memory.settings?.reducedMotion} onReady={()=>setPhase(p=>p==='assembling'?'ready':p)}/></div>
            <div className="scene-caption"><span className="coordinate">01 / EMBODIED INTELLIGENCE</span><span className="scene-title">Made of possibility.</span><span className="scene-description">A thousand points of light. One familiar presence.</span></div>
            <div className="scene-controls"><span className="orbit-tip"><Orbit size={14}/> Drag to explore</span><div><button className="icon-btn" aria-label="Wave hand" title="Wave hand" disabled={phase!=='ready'} onClick={wave}><Hand size={17}/></button><button className="icon-btn" aria-label={voice?'Mute voice':'Enable voice'} title={voice?'Mute voice':'Enable browser voice'} onClick={()=>{setVoice(!voice);if(voice)window.speechSynthesis?.cancel();}}>{voice?<Volume2 size={17}/>:<VolumeX size={17}/>}</button><span className="control-divider"/><button className="icon-btn" aria-label="Replay assembly" title="Replay assembly" onClick={replay}><RotateCcw size={16}/></button><button className="icon-btn" aria-label={focus?'Exit focus view':'Focus view'} title="Focus view" onClick={()=>setFocus(!focus)}><Maximize2 size={16}/></button><button className={`icon-btn power-button ${phase!=='dormant'?'on':''}`} aria-label={phase==='dormant'?'Awaken Mother':'Rest Mother'} title={phase==='dormant'?'Awaken Mother':'Rest Mother'} onClick={togglePower}><Power size={17}/></button></div></div>
          </section>
          {page==='home' ? <section className="conversation-card" aria-label="Conversation">
            <div className="conversation-header"><div><MessageCircle size={17}/><span>A conversation, together.</span></div><div className="menu-wrap"><button className="icon-btn" aria-label="Conversation options" onClick={()=>setMenuOpen(!menuOpen)}><MoreHorizontal size={19}/></button>{menuOpen && <div className="dropdown"><button disabled={busy} onClick={()=>{setMemory({...memory,conversations:[]});setMenuOpen(false);}}>Start a new conversation</button><button onClick={()=>{setPage('connections');setMenuOpen(false);}}>Export your memory</button></div>}</div></div>
            <div className="messages" role="log" aria-live="polite">{messages.map((message,index)=><article key={message.id || index} className={`message ${message.role}`}><div className="message-byline">{message.role==='assistant'?<span className="mother-mini"><Atom size={14}/></span>:<span className="you-mini">Y</span>}<span>{message.role==='assistant'?'Mother':'You'}</span><span className="message-engine">{message.role==='assistant'?message.engine || 'Local model':''}</span></div><div className="message-content">{message.content}</div>{message.role==='assistant' && message.id!=='welcome' && <div className="message-feedback"><button className={`icon-btn ${memory.feedback?.find(f=>f.messageId===message.id)?.rating==='positive'?'selected':''}`} aria-label="Helpful response" onClick={()=>feedback(message,'positive')}><ThumbsUp size={12}/></button><button className={`icon-btn ${memory.feedback?.find(f=>f.messageId===message.id)?.rating==='negative'?'selected':''}`} aria-label="Unhelpful response" onClick={()=>feedback(message,'negative')}><ThumbsDown size={12}/></button><span>Help Mother improve</span></div>}</article>)}{busy && <div className="thinking"><span/><span/><span/> {neuralReady?'Thinking locally…':'Opening the guide…'}</div>}<div ref={endRef}/></div>
            {messages.length<2 && <div className="conversation-starters"><span className="tiny-label">A LITTLE INSPIRATION</span><button onClick={()=>send('How can we learn together?')}><Sparkles size={14}/> Let’s learn something new <ArrowUpRight size={13}/></button><button onClick={()=>send('How can I take you to another device?')}><Link2 size={14}/> Take Mother with me <ArrowUpRight size={13}/></button></div>}
            <form className="composer" onSubmit={e=>{e.preventDefault();send();}}><textarea aria-label="Message Mother" placeholder="Share a thought with Mother…" value={input} maxLength={12000} rows={2} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/><div className="composer-bottom"><span>{neuralReady?<><Cpu size={11}/> Thinking on your hardware</>:<><WifiOff size={11}/> Offline guide · no model connected</>}</span><div><button type="button" className={`icon-btn ${activity==='listening'?'listening':''}`} aria-label={activity==='listening'?'Stop microphone':'Use microphone'} title={recognitionAvailable?'Browser recognition may use your browser provider’s servers':'Speech recognition unavailable in this browser'} onClick={toggleListening}>{activity==='listening'?<MicOff size={16}/>:<Mic size={16}/>}</button><button className="send-btn" aria-label={busy?'Cancel response':'Send message'} disabled={!busy && !input.trim()} type={busy?'button':'submit'} onClick={busy?()=>pending.current?.abort():undefined}>{busy?<X size={16}/>:<ArrowUp size={17}/>}</button></div></div></form>
            <div className="conversation-footnote"><Fingerprint size={11}/> Your conversations are saved in this browser.</div>
          </section> : <section className="workspace-panel"><div className="workspace-panel-header"><span>{navigation.find(n=>n.id===page)?.label}</span><button className="icon-btn" aria-label="Back to Sanctuary" onClick={()=>setPage('home')}><X size={18}/></button></div><div className="workspace-panel-content">{page==='knowledge'?<KnowledgePanel hostedPreview={hostedPreview} memory={memory} onMemoryChange={setMemory}/>:page==='connections'?<>{hostedPreview && desktopFeature('Your memory travels with you.', 'Keep your preferences and memory here, or download Mother to connect a local neural model and compatible apps.')}<div className={`connection-tabs ${hostedPreview?'hidden-preview-controls':''}`} role="tablist" aria-label="Connection settings"><button role="tab" aria-selected={connectionTab==='model'} onClick={()=>setConnectionTab('model')}>My devices & intelligence</button><button role="tab" aria-selected={connectionTab==='apps'} onClick={()=>setConnectionTab('apps')}>App permissions</button></div>{connectionTab==='apps' && canUse('appGrants')?<IntegrationsPanel/>:<ConnectPanel hostedPreview={hostedPreview} onOpenSetup={openSetup} installAvailable={!!installPrompt} onInstall={async()=>{if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);}}} memory={memory} onMemoryChange={next=>{setMemory(next);fetch('/api/models').then(r=>r.json()).then(setModels).catch(()=>{});}}/>}</>:page==='code'?!canUse('projectAccess')?desktopFeature('Bring Mother to your project.', 'Choose and edit a project in the desktop app. Your browser preview cannot open folders on the hosting computer.'):<CodeWorkspace model={neuralReady?selectedModel:''} onAsk={({content,path,prompt})=>{const excerpt=content.slice(0,8000);setInput(`${prompt.slice(0,2000)}\n\nFile: ${path}\n${content.length>8000?'Source excerpt (first 8,000 characters):':'Source:'}\n${excerpt}`);setPage('home');setNotice(neuralReady?'Your file is attached to a draft message. Review it, then send.':'Your file is attached to a draft. Connect a local model for AI code assistance.');}}/>:page==='downloads'?<DownloadPanel canInstall={!!installPrompt} isDesktop={!!window.motherDesktop} onInstall={async()=>{if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);}}}/>:<><div className="connection-tabs" role="tablist" aria-label="Security workspace"><button role="tab" aria-selected={securityTab==='local'} onClick={()=>setSecurityTab('local')}>Files & code</button><button hidden={!canUse('securityBridge')} role="tab" aria-selected={securityTab==='host'} onClick={()=>setSecurityTab('host')}>Security tool bridge</button></div>{securityTab==='host' && canUse('securityBridge')?<KaliPanel/>:<ToolsPanel/>}</>}</div></section>}
        </div>
        <section className="foundation-cards" aria-label="Mother capabilities"><button onClick={()=>setPage('knowledge')}><span className="feature-icon"><BookOpen size={19} strokeWidth={1.4}/></span><span><strong>A mind you help shape</strong><small>{memory.knowledge?.length || 0} approved sources · {memory.feedback?.length || 0} pieces of feedback</small></span><ArrowUpRight size={16}/></button><button onClick={()=>setPage('connections')}><span className="feature-icon gold"><Cpu size={19} strokeWidth={1.4}/></span><span><strong>Free to think independently</strong><small>{neuralReady?'Connected to a free local model':'Open tools. Local models. No paid API.'}</small></span><ArrowUpRight size={16}/></button><button onClick={()=>setPage('connections')}><span className="feature-icon lavender"><HardDrive size={19} strokeWidth={1.4}/></span><span><strong>At home, wherever you are</strong><small>Export your memory. Bring your world.</small></span><ArrowUpRight size={16}/></button></section>
        <footer className="page-footer"><span><span className="status-dot"/> YOUR DATA. YOUR DEVICES. YOUR MOTHER.</span><span>Built to grow with you <span className="footer-star">✧</span></span></footer>
      </main>
    </div>
    {showSetup && canUse('modelSetup') && <SetupWizard onClose={()=>{setShowSetup(false);setMemory(current=>({...current,settings:{...current.settings,setupVisited:true}}));}} onComplete={({model})=>{setMemory(current=>({...current,settings:{...current.settings,model,setupVisited:true}}));setShowSetup(false);fetch('/api/models').then(r=>r.json()).then(setModels).catch(()=>{});setNotice('Your local model is selected. Mother is ready for a conversation when the runtime is available.');}}/>}
  </div>;
}
