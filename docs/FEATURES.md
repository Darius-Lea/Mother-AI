# Mother: what works and what still needs building

Mother is a local-first application foundation, not a recreated frontier-model training laboratory. A model's reasoning, coding skill, speed, and reliability depend on the selected model and available hardware. No tested benchmark establishes equivalence with ChatGPT, Codex, Claude, or the frontier models from OpenAI and Anthropic. Open-weight local models can be useful without a paid API; they are not guaranteed to match those systems.

Status describes implemented behavior, not all-platform certification. Tests with an injected model verify software integration; they do not establish the quality of an actually installed model. In this cloud build, local language-model replies remain unverified because official model downloads have been blocked by the managed network policy. Neural speech has been verified separately.

| Reference-sheet requirement | Status | Current behavior and practical limit |
| --- | --- | --- |
| Feminine, three-dimensional blue and gold particle humanoid | Implemented | Procedural geometry, face, eyes, particle hair, chest core, full body, and articulated limbs. A rendered visual, not physical nanotechnology. |
| Spark, rise, assembly, awakening, disassembly | Implemented visual sequence | The live 3D figure assembles, idles, and disperses. This is an animation, not creation of a new consciousness. |
| Turn, move, arms, hands, speech gestures | Partial | Orbit rotation, pose movement, fingers, arm gestures, breathing, blinking, and speaking animation. No physical body, autonomous scene navigation, or motion capture. |
| Interactive voice, emotional expression | Partial | Free Kokoro neural speech with three profiles, verified model download, native desktop CPU inference where supported and browser WASM fallback. A real generated sample is included. Click-to-start hands-free English recognition runs locally using Vosk, pauses during playback, and resumes between turns. First-time speech packs and microphone access require consent. Streaming model sentences start speech before the complete answer. No proven emotional understanding. |
| Wake words, always listening | Not implemented | User starts microphone input explicitly. Background hotword recognition is not provided. |
| Cinematic startup, awakening and shutdown sounds | Not implemented | No complete reference-sheet sound design is bundled. |
| Free neural conversations | Implemented integration; runtime required | A local Ollama service and an installed compatible open-weight model generate actual responses. A clearly labeled rule-based offline guide works separately. |
| Strongest possible reasoning and programming | Partial | Hardware-aware free-model choices and reference context. Larger models require more resources. No guarantee of frontier-model parity. |
| Guided installation without developer setup | Partial distribution | Desktop packaging includes the application's runtime and uses normal operating-system installation. Model/runtime consent and operating-system confirmations still apply. Only actually built artifacts appear as downloads. |
| Windows, Mac, Linux | Packaging configured | Platform-specific installers and native-build workflows. An unsigned, generated package is different from a signed, tested public release. Check the download catalog for actual artifacts. |
| Phones and tablets | Partial | Installable mobile web interface on compatible browsers with a reachable HTTPS deployment. No bundled native Android/iOS neural runtime or app-store release. |
| USB portability | Partial | Memory export/import; developer source archive; compatible desktop app packages. A USB drive does not make one executable compatible with every operating system. |
| Jump between devices over Bluetooth or Wi-Fi | Not implemented | No automatic installation, migration, pairing, or unrestricted remote control. A compatible service and explicit authorization are required. |
| Long-term memory and conversation context | Implemented, bounded | Browser-local conversations, profile, approved source excerpts, and reviewed corrections. Memory is not an encrypted credential vault. |
| Learning from safe dataset links and files | Implemented reference workflow | Bounded text inspection, source preview, SHA-256 fingerprints, and explicit approval. Public HTTPS and a checksum do not certify truth, license, or freedom from poisoning. |
| Active training and feedback | Partial | Ratings, corrections, reference retrieval, and curated teaching-example JSONL exports. No automatic neural weight updates, training evaluation, rollback of trained models, or autonomous self-modification. |
| Internet research and verification 24/7 | Partial, user directed | Public HTTPS reader, free search endpoints, conversation research toggle, reviewed source attachment and an isolated native browser. Actual public-page access verified; providers can block search. No continuous autonomous research agent or guarantee of factual correctness/anonymity. |
| Programming assistant that edits projects | Partial, approval based | Selected local folders, code inspection, editable change proposals, stale-file checks, explicit apply, and guarded rollback. No unrestricted shell or automated deployment agent. |
| Red teaming and cybersecurity | Partial defensive tools | Local file fingerprints, code pattern review, model discussion, and a limited Kali-compatible tool bridge with approved single-host Nmap checks when Nmap is installed. No full Kali suite, malware scanner, or proof of security. |
| Connect to other applications | Implemented scoped interface | User-created app grants, individually scoped/revocable bearer tokens, actual chat and static-code-review endpoints. Other applications need adapters that use these interfaces. |
| Every app, all hardware, the whole IoT | Not implemented universally | Each service or device needs a supported protocol, credentials, permission, and an adapter. An API alone does not control arbitrary technology. |
| ChatGPT, Claude, Midjourney, DALL·E and other logo integrations | Not implemented as vendor connections | Logos in a reference image do not confer API access. No paid cloud-model key is required by the local build. Separate vendor integrations remain separate work. |
| Business, social media, sales, scheduling and phone calls | Not implemented as workflows | No connected mail/calendar/social accounts, outbound calls/messages, or autonomous sales actions. |
| Cars, smart homes and AR/VR | Not implemented as device adapters | The reference aspiration is not verified device compatibility. |
| Active/background/sleep/offline modes | Partial | Visual rest/awake states, cached web shell and offline guide. No cross-device background agent or offline neural training mode. |
| Self healing, self building and instant updates | Partial updates | An explicit in-app updater checks the fixed preview catalog, downloads and verifies the compatible installer in the background, and opens normal OS installation when requested. No model-directed self-modification or autonomous error repair. |
| Permission controls and approval for sensitive actions | Partial | Scoped integration grants, desktop session protection, selected coding workspace, explicit change review/apply, and data-source approval. No complete organization-wide authorization system. |
| End-to-end encryption and encrypted credentials | Not implemented as a general vault | Integration tokens are stored as hashes. Browser memory/JSON exports are readable. Transport and privacy depend on deployment; do not claim universal end-to-end encryption. |
| Audit logs and compliance | Partial owner activity | Bounded local web-research and browser metadata logs, protected owner access, rotation and clearing. Logs stay outside model context. No complete immutable forensic archive or certified compliance program. |
| Tiny package, minimal memory, instant response | Hardware dependent | The graphic has a resource cost; neural models can occupy several gigabytes and use substantial RAM/compute. No universal performance guarantee. |

## Connecting an application today

Create an app connection, name it, choose only the required scopes, and copy the token once into that application's supported integration settings. The supplied API allows actual local-model conversations and static code review. It does not automatically add Mother to third-party software, grant permission to other accounts, or turn model output into executable authority. See [INTEGRATIONS.md](INTEGRATIONS.md).

## What “no visible files” means

An installed desktop app keeps source folders and terminal commands out of the ordinary user flow. ASAR packaging is not encryption or a guarantee that the device owner cannot inspect application code. Do not embed private credentials or proprietary server secrets in distributed client files. Trusted signing, public hosting, app-store publication, native mobile builds, and hardware-specific adapters need their own completed work and verification.
