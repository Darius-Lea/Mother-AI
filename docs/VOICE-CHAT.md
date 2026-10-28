# Hands-free voice chat

Click the microphone once, approve the free speech packs, and allow microphone
access. Speak and then pause. Mother sends the recognized words automatically,
answers aloud, and returns to listening. The button stays on until Stop voice
chat, Rest Mother, leaving the conversation page, or hiding/closing the app.
Talk now interrupts the current reply, waits for its cleanup, and reopens the
microphone. The microphone is closed during reply generation and playback to
prevent Mother's own voice becoming another user message.

English recognition uses Vosk-Browser 0.0.8 and the Apache-2.0 Vosk small US
English 0.15 model (41,184,862 bytes, about 39 MiB). Its immutable upstream source
and SHA-256 digest are pinned in `server/recognition.js`. Both the server cache
and browser download check the digest before loading. Browser CacheStorage
retains the archive; Vosk's WASM worker performs recognition locally. Microphone
audio is not uploaded to a speech service. AudioWorklet capture buffers samples on the audio thread so animation does not drop microphone audio; older browsers fall back to ScriptProcessor. Final transcript text is saved with
the conversation and sent to the selected local model. First preparation also
loads Mother's separate Kokoro speech-output model when that voice is selected.

`scripts/vosk-csp-plugin.js` converts three known Emscripten embind code-generation
wrappers into ordinary closures at build time. It verifies the embedded worker's
digest and fails closed if the dependency changes. This allows the existing
strict Content Security Policy to remain in place without `unsafe-eval`.

A local neural model is required for AI conversation. The hosted website labels
its offline guide and does not provide a remote AI model. Recognition quality
varies with accent, background noise and microphone. Reply speed depends on the
selected model and available CPU/memory; the first load takes longer. Streaming
replies and concise spoken answers help speech begin before the whole response
is complete. This preview does not promise the latency or speech quality of a
paid hosted voice system.

Verification: `node --test src/lib/voice-chat.test.js src/lib/local-recognition.test.js`.
For actual WASM recognition and actual native Kokoro playback, build the app and
run `MOTHER_RECOGNITION_MODEL=/path/to/vosk-model-small-en-us-0.15.tar.gz
MOTHER_VOICE_CACHE=/path/to/verified/voice-cache node scripts/voice-chat-smoke.mjs`.
That smoke test uses a deterministic streamed language-model fixture and does
not measure LLM inference speed. It checks automatic turn submission, speech
before stream completion, microphone pause/resume, and stop cleanup.
