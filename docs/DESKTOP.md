# Mother desktop downloads

Mother's desktop installer includes her browser engine, local server, Node runtime, and verified local Ollama engine. People installing Mother do not need a terminal, project folders, ZIP extraction, or a separate engine installation.

## Download experience

- **Windows:** open the `.exe` installer and approve normal OS prompts. It installs for the current user, creates shortcuts, and opens Mother without a folder-selection wizard or administrator service.
- **Mac:** open the `.pkg` and follow the standard OS installer, then open Mother from Applications or Launchpad. Intel and Apple Silicon installers are separate.
- **Linux:** open the `.deb` with the system package installer on Debian/Ubuntu. Other Linux distributions need separate packaging support.
- **Phones and tablets:** these desktop files cannot install on Android or iOS. The mobile product is the web app's Install/Add to Home Screen flow, and its neural API needs a compatible running server. Native mobile packages and on-device neural runtimes are separate development work.

The website's **Get Mother** page detects the device and links directly to the appropriate installer in the approved GitHub `mother-preview` prerelease channel. Downloads appear only after all supported builds finish and their receipts, package headers, byte counts, and SHA-256 values pass verification. A pending build never becomes a fabricated download link. GitHub Actions artifacts remain an internal build handoff, outside the consumer flow.

## First-run intelligence

The app starts its included engine automatically after verifying every bundled runtime file. A compatible existing local Ollama service is reused. The language model downloads separately inside Mother's wizard after the user approves its size and resource use.

The engine listens only on this computer. Model files stay in Mother's app-data directory. Closing Mother stops only the engine process she started; an existing separately running service is left alone. No background system service, elevated installer, or arbitrary executable path is exposed by the renderer.

The backend model-setup endpoints and wizard handle model downloads, verification, progress and cancellation. Availability and quality must be tested on the target device; a model name alone is not evidence of ChatGPT, Codex, or Claude parity. See [automatic runtime](AUTOMATIC-RUNTIME.md) for build provenance and lifecycle details.

## Developer build commands

Use the pinned Node and package lock, then:

```sh
npm ci
python3 scripts/prepare-runtime.py --platform linux --arch x64
npm run desktop
npm run desktop:pack
npm run desktop:dist -- --x64 --publish never
```

`desktop` opens the current local app. `desktop:pack` creates an unpacked development build. `desktop:dist` creates the host platform's configured distributable artifacts under `releases/desktop/`. `npm run desktop:linux` explicitly builds the x64 AppImage and Debian package on Linux.

The runtime-preparation command is a Linux x64 example; choose the matching platform and architecture for other targets. **Build Mother desktop installers** runs after every main push and on manual dispatch. Native Windows x64/arm64, Mac x64/arm64, and Linux x64 jobs have read-only repository permissions. Only the final publication job has permission to upload preview files. It rejects stale commits and incomplete builds, uploads content-addressed installers, then updates the small discovery catalog last. No production release is created.

Code signing and macOS notarization are not configured. Builds are unsigned development distributions. Windows SmartScreen and macOS Gatekeeper can show warnings; do not claim those warnings have been eliminated or instruct users to disable platform protection. A production public download needs signing/notarization and testing on its target OS.

## Application packaging and privacy

The installer contains a compiled frontend and an ASAR application archive. It excludes frontend source folders, tests, environment files, and developer instructions from the installed UI. Ordinary users do not browse source files while installing or running Mother.

ASAR is packaging, not encryption or digital rights management. A device owner or a skilled reverse engineer can inspect JavaScript and installed resources. Never place API secrets or credentials in the shipped application. It is impossible to guarantee that an owner cannot inspect software running on their own device.

Mother uses the stable secure application origin `mother://app`, so browser memory is retained across application launches even though its internal local server gets a different random loopback port. App updates should preserve that origin. Uninstalling defaults to preserving app data; clearing system application data or browser storage can still remove memory. Keep explicit portable-memory backups.

## Desktop security design

The renderer is sandboxed with context isolation and no Node integration. Production developer tools are disabled. A restrictive Content Security Policy rejects remote scripts, frames, and network access. External navigation is blocked; only fixed official help/download pages can open in the system browser.

The main process proxies its private `mother://app` scheme to a loopback-only server and injects a random per-session token. That token is never returned to JavaScript, saved in memory exports, or included in logs. Backend desktop-token middleware is required to protect local APIs. App-specific external connection routes use their own authorization and connection tokens.

The preload bridge exposes only system information, included-engine status/retry, in-app help, and a user-visible native project-folder picker. It has no generic shell, filesystem read, arbitrary IPC, or arbitrary URL-opening method. A selected folder path does not by itself authorize writes or code execution; the project connector must still enforce its own access rules.
