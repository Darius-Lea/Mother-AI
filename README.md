# Mother AI — First release preview

**1.0.0-preview.1 · Preview downloads · Not yet market ready**

Mother is a free, local-first assistant workspace with a live blue-and-gold 3D particle character. This is the preview of the first planned release. No public product release has been published.

## Try the desktop app

Open **Get Mother** on the website and select **Download Mother**. The page detects your operating system and offers the direct installer when its verified build has finished. GitHub hosts these files in the explicitly marked `mother-preview` prerelease channel. No ZIP extraction, GitHub sign-in, source folders, or terminal commands are part of this download flow.

- **Windows:** open the setup `.exe` and approve normal operating-system prompts. The per-user installer adds shortcuts and opens Mother.
- **Mac:** open the `.pkg` and complete the normal installer, then open Mother from Applications or Launchpad. Intel and Apple Silicon downloads are separate.
- **Linux:** open the `.deb` in the normal Debian/Ubuntu package installer.
- **Phone or tablet:** use the responsive installable web app after a secure, reachable HTTPS deployment. Native Android/iPhone packages and public mobile hosting are not supplied yet.

Desktop packages include Node, Electron, and the local Ollama AI engine. Packages remain unsigned previews, so target-device testing and trusted signing/notarization are still required for a public production release. See [desktop installation](docs/DESKTOP.md) and [mobile compatibility](docs/MOBILE.md).

## Set up Mother's intelligence

Mother starts her included local AI engine automatically, or reuses a compatible engine already running on the computer. The first-run wizard recommends free models suited to the computer's RAM and downloads your chosen model with actual progress and cancellation. No separate Ollama installer is needed.

No paid API key is required. Larger models use more storage and memory and can be slow on CPU. Their names do not establish equivalence with ChatGPT, Codex, or Claude. The local model generates neural answers only when it is installed and running. Until then Mother explicitly uses a small **Offline guide**; that guide is not neural AI.

Real neural inference has not been verified in the current cloud machine: official model download destinations have returned network-policy HTTP 403. No credentials are missing. See [model setup and hardware](docs/MODELS.md).

## What you can do

- Explore Mother's real 3D body, assembly, facial motion, arms, fingers and speech gestures.
- Converse with a connected free local neural model, or use the clearly labeled offline guide.
- Review dataset links or files, approve sources, and retrieve relevant excerpts.
- Save feedback and corrections and export reviewed teaching examples as JSONL. This does not automatically retrain model weights.
- Export/import portable memory to another Mother installation or a USB drive.
- Grant compatible apps scoped, revocable access to local chat or code pattern checks. See [app integrations](docs/INTEGRATIONS.md).
- Select a local coding project, discuss files with a model, review changes, explicitly apply them, and restore originals when safe. See [coding studio](docs/CODING.md).
- Hash local files, review code patterns, and use a limited [security tool bridge](docs/KALI.md) for explicitly approved single-host Nmap checks when the tool is installed. The full Kali suite is not bundled.

Every app and IoT device needs a supported interface, permission, and an adapter. Mother does not automatically control arbitrary technology, jump between devices, train her own weights, or provide all the aspirational features pictured in the reference sheet. The complete [feature status](docs/FEATURES.md) distinguishes working, partial, and unimplemented behavior.

## Render web preview

Deploy the latest `main` commit. Use build command `npm ci --include=dev && npm run build` and start command `npm start`. Existing Render services still using `npm install` and `node desktop/main.cjs` are supported by the compatibility bootstrap. The hosted preview keeps desktop-only controls private and links to test downloads. See [Render deployment](docs/RENDER.md).

## Developers

Use Node.js **24.19.0** and the checked-in lockfile:

```sh
npm ci
npm run dev
```

For the production web app:

```sh
npm run build
npm start
```

The local API binds to `127.0.0.1:3001`; Vite proxies API requests during development. `MOTHER_DATA_DIR` selects the app-grant registry directory, and desktop builds choose the operating system's app-data folder automatically. Do not expose the unauthenticated web owner interface publicly. Custom trusted hostnames require `MOTHER_ALLOWED_HOSTS`. Public mobile hosting needs a separate authentication and transport deployment.

```sh
npm test
npm run test:e2e
python3 scripts/prepare-runtime.py --platform linux --arch x64
npm run desktop
npm run desktop:dist -- --x64 --publish never
```

Browser tests use Chromium at `/usr/bin/chromium` or `CHROMIUM_PATH`. They test actual WebGL and user workflows; mocked model integration tests do not prove a real model is installed. The desktop smoke test in `scripts/desktop-smoke.mjs` checks isolation, API authentication, and memory across restarts.

The runtime-preparation command above is a Linux x64 developer example; use `win32` or `darwin` and the matching architecture for other build targets. Render builds only the web preview and does not download this desktop engine.

The optional `npm run package:portable` creates a **developer source archive**, not a consumer installer. Compatible desktops still need their own model files. Packaged ASAR resources keep implementation files outside the normal user experience, but cannot prevent a device owner from inspecting software. Never embed credentials in distributed client code.

Memory is stored locally in the browser profile and readable JSON exports. It is not an encrypted vault. Browser/device speech availability varies; recognition may use browser-provider servers. See [architecture](docs/ARCHITECTURE.md), [local API](server/README.md), and the feature status before deploying.
