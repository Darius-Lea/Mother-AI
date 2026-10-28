import {useState} from 'react';
import {Mic, X, LoaderCircle} from 'lucide-react';
export default function VoiceChatSetup({inputStatus={},outputStatus={},onStart,onClose,hostedPreview=false,starting=false}) {
  const [consent,setConsent]=useState(false);
  const loading=starting || ['loading','downloading','verifying'].includes(inputStatus.state) || ['loading','downloading'].includes(outputStatus.state);
  const error=inputStatus.error || outputStatus.error;
  return <div className="update-overlay"><section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-chat-title">
    <div className="section-heading"><span className="eyebrow">TALK WITH MOTHER</span><button type="button" className="icon-btn" onClick={onClose} aria-label="Close voice chat setup"><X size={18}/></button></div>
    <h2 id="voice-chat-title">A conversation, without typing.</h2>
    <p>Click once to start. Speak, then pause. Mother answers aloud and listens again. Click Stop voice chat whenever you are finished.</p>
    <p className="field-hint">Free English speech input (39 MB) and Mother’s human voice (109 MB) download once. Your microphone audio stays on this device. Allow microphone access when your device asks.</p>
    {hostedPreview && <p className="notice">This website uses the offline guide. Use the desktop app with a local model for AI conversations.</p>}
    <label className="checkbox-field"><input type="checkbox" checked={consent} disabled={loading} onChange={event=>setConsent(event.target.checked)}/>I approve the free speech packs and microphone use for voice chat.</label>
    {loading && <div role="status"><p>{['loading','downloading','verifying'].includes(inputStatus.state)?'Preparing speech input…':'Preparing Mother’s voice…'}</p><progress aria-label="Voice chat preparation" max="1" {...(Number.isFinite(inputStatus.progress)&&inputStatus.progress>0?{value:inputStatus.progress}:{})} style={{width:'100%'}}/><p className="field-hint">This first preparation may take a moment. Later conversations reuse the downloaded packs.</p></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="button-row"><button className="button primary" type="button" disabled={!consent||loading} onClick={onStart}>{loading?<LoaderCircle size={15} className="spin"/>:<Mic size={15}/>} {loading?'Preparing…':'Start voice chat'}</button><button type="button" className="button secondary" onClick={onClose}>Continue typing</button></div>
    <p className="field-hint">Replies begin sentence by sentence. Speed depends on your computer and selected local model. The microphone pauses during Mother’s reply to prevent echoes.</p>
  </section></div>;
}
