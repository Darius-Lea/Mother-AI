# Mother's natural neural voice

Open **Mother’s voice** to hear an actual sample before downloading. Choose
Heart, Bella or Emma, approve the free voice pack, then select **Download or load
human voice**. After preparation, use **Hear Mother’s voice** and enable spoken
replies. Speed is adjustable. The basic device voice remains an explicitly
selected fallback; a failed neural setup never silently substitutes it.

The voice uses Kokoro 82M v1.0, an Apache-2.0 model, with included voice profiles
and notices. The pinned official Kokoro ONNX release file is 114,119,327 bytes
with SHA-256 `ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c`.
The first download needs internet and storage; generating speech uses local
resources. There is no paid speech API or voice subscription.

## Local execution

Supported desktop CPU targets use the packaged ONNX native runtime on Mother's
host computer. This includes Windows x64/ARM64, Linux x64 and Apple Silicon.
The fixed speech API accepts bounded text, one included voice and a bounded
speed. It does not accept model URLs, files, commands or arbitrary executables.
Model and profile bytes are verified before use. One synthesis runs at a time.
The desktop session token protects preparation and synthesis; external app
grants do not grant this owner-only access.

The hosted preview and Intel Mac fallback use an isolated browser worker and
ONNX WebAssembly. Only the fixed voice model file can be fetched through the
public hosted API. Hosted preparation/synthesis endpoints are denied, so the
public server never processes visitors' spoken text. Browser inference uses
up to four WASM threads where cross-origin isolation is supported, otherwise one.
This browser path can be substantially slower than native desktop inference.

The native engine receives text only on the computer hosting Mother. Browser
inference keeps text in that browser. A phone connected to a private Mother host
may send its speech text to that host. No speech text is sent to an external voice
provider or saved in the voice cache. Existing conversation memory is separate.

Downloaded model data is kept in owner-private app storage; browser inference
also uses a checksum-named local cache when available. Prior voice-pack consent
is stored on this device separately from memory exports. Enabled voice can
reload after restart without another manual download procedure. Browsers and
operating systems can still require a click to permit audio playback.

## Performance and verification

Actual browser inference and the native path generated non-silent 24 kHz audio
for the preview sentence. On the cloud CPU with software-rendered graphics, a
4.55-second passage took about 55 seconds including playback through WASM and
about 16 seconds including playback through the native desktop path. A direct
native synthesis check, including model initialization, took about 7 seconds.
These figures do not predict every device's speed or establish human-level
emotion or speech understanding. Hardware and text length affect latency.

Voice tests cover consent, integrity, redirected assets, partial downloads,
confined/hidden caches, explicit fallback, cancellation, input limits and
concurrent synthesis. The real synthesis smoke checks model loading, UI playback
and an exported WAV; it is separate from mocked integration tests. The included
sample is generated audio from that verified pipeline.
