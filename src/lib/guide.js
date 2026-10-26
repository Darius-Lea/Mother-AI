import { retrieveContext } from './memory.js';

export function referenceDocuments(memory) {
  const corrections=(memory.feedback || []).filter(f=>f.prompt?.trim() && f.correction?.trim()).map(f=>({
    title:'Your reviewed teaching note', source:'Local feedback', approved:true,
    text:`Question: ${f.prompt}\nYour corrected answer: ${f.correction}`,
  }));
  return [...(memory.knowledge || []),...corrections];
}

export function localReply(input, memory) {
  const text = input.toLowerCase();
  const name = memory.profile?.name;
  const context = retrieveContext(input, referenceDocuments(memory));
  if (/\b(hello|hi|hey|good morning|good evening)\b/.test(text)) return `Hello${name ? `, ${name}` : ''}. I'm here. What would you like to explore together?\n\nI'm in offline guide mode right now. Connect a free local model in Connections for open-ended AI conversation.`;
  if (/\b(your name|who are you|what are you)\b/.test(text)) return "I'm Mother, your personal AI workspace. My body is a live 3D particle simulation; my memory stays in this browser. I'm currently an offline guide, not a running neural model. You can connect Ollama in Connections to give me a local AI brain.";
  if (/\b(portab\w*|usb|devices?|bluetooth|wi-fi|wifi|travel\w*|phones?)\b/.test(text)) return "Take your memory with you: open Connections and export a Mother memory file. Save it to a USB drive or transfer it to a device you trust, then import it into Mother there.\n\nThe web interface works on compatible phone, tablet, and desktop browsers. Each device still needs access to its own model or a trusted local model server. Bluetooth does not grant automatic access to another device.";
  if (/\b(learn\w*|datasets?|train\w*|feedback|knowledge)\b/.test(text)) return "Let's build knowledge carefully. Open Knowledge, add a public HTTPS dataset or a local text file, inspect its preview and fingerprint, and explicitly approve it. Only approved material enters your reference library.\n\nYour feedback is saved locally for review and export. This version retrieves references; it does not retrain neural weights or automatically decide a source is truthful.";
  if (/\b(code|coding|program\w*|secur\w*|red team\w*|audit\w*|hash\w*|cyber\w*)\b/.test(text)) return "Open Security lab for local SHA-256 file verification and rule-based code checks. Files stay in your browser. These are useful tools, not a complete security audit.\n\nFor deeper programming help, connect a local model. Any real testing of external systems needs their owner's authorization; this version does not run network attacks or execute pasted code.";
  if (/\b(free|cost\w*|models?|brain|ollama|intelligen\w*)\b/.test(text)) return "Mother has no paid API dependency. In the desktop app, open Connections → Open guided setup, choose a free model, and approve its download. Mother includes the local AI engine and handles setup without a terminal or separate engine installer.\n\nModel downloads need internet and disk space; inference uses your hardware. The offline guide and local tools work without a model.";
  if (/\b(arms?|hands?|wave|mov\w*|body|look|appear\w*)\b/.test(text)) return "My body is rendered live in 3D, with articulated arms and hands, blue particles, gold energy, and a luminous core. Drag the scene to orbit around me. Use the wave control to see a gesture, or the power control to replay my assembly.";
  if (context) return `Here are relevant excerpts from your approved reference library:\n\n${context}\n\nThese are source excerpts, not verified facts or a generated answer. Connect a local model to discuss them in depth.`;
  return "I'm listening. My offline guide can help you explore my appearance, free local models, portable memory, learning, and security tools. Open Connections to enable an actual local neural model for open-ended conversation.\n\nWhat would you like to work on first?";
}
