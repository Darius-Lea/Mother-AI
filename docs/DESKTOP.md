# Mother desktop downloads

Mother can be packaged as a normal application with its own browser engine, local server, and Node runtime. People installing a built desktop artifact do not need to install Node, open a terminal, unpack project folders, or run developer commands. The application starts its local service itself.

## Download experience

- **Windows:** open the `.exe` installer, follow the visible installation wizard, and launch Mother from Start or the desktop shortcut. The default is a per-user installation without an administrator service.
- **Mac:** open the `.dmg` and drag Mother to Applications. Intel and Apple Silicon artifacts are separate.
- **Linux:** open a `.deb` with the system package installer on Debian/Ubuntu, or use the AppImage on a compatible Linux desktop. AppImage execution/FUSE support depends on the distribution.
- **Phones and tablets:** these desktop files cannot install on Android or iOS. The mobile product is the web app's Install/Add to Home Screen flow, and its neural API needs a compatible running server. Native mobile packages and on-device neural runtimes are separate development work.

An artifact can be downloaded only after it has actually been built and distributed. The workflow below does not create a public download page or silently publish anything.

## First-run intelligence

The desktop application bundles the Mother interface and local service, not a multi-gigabyte language model. Its first-run wizard can inspect this device, show model sizes, open the official Ollama download page, detect the installed service, and download a selected model through Mother's backend.

`window.motherDesktop.openOllamaDownload()` opens the official operating-system-specific download page in the user's browser. It does **not** claim to install Ollama automatically. Completing an official OS installer and any OS approval remains a visible user action. Mother never executes an unverified installer, bypasses package-signature checks, or hides a downloaded background service. Model downloads also require the user's explicit selection and enough disk space, RAM, and network access.

Once Ollama is installed, users should not need terminal commands for Mother's model-download step. The backend model-setup endpoints and wizard own that operation. Availability and the resulting model quality must be tested on the target device; a model name alone is not evidence of ChatGPT, Codex, or Claude parity.

## Developer build commands

Use the pinned Node and package lock, then:

```sh
npm ci
npm run desktop
npm run desktop:pack
npm run desktop:dist
```

`desktop` opens the current local app. `desktop:pack` creates an unpacked development build. `desktop:dist` creates the host platform's configured distributable artifacts under `releases/desktop/`. `npm run desktop:linux` explicitly builds the x64 AppImage and Debian package on Linux.

A manual GitHub Actions workflow, **Build Mother desktop installers**, builds Windows, macOS, and Linux installers on their corresponding operating systems and uploads them as workflow artifacts for review. It has read-only repository permissions and does not publish a release. Installing the Electron development dependency downloads the official Electron runtime; electron-builder may also download official packaging tools. Network access to those official release assets is required.

Code signing and macOS notarization are not configured. Builds are unsigned development distributions. Windows SmartScreen and macOS Gatekeeper can show warnings; do not claim those warnings have been eliminated or instruct users to disable platform protection. A production public download needs signing/notarization and testing on its target OS.

## Application packaging and privacy

The installer contains a compiled frontend and an ASAR application archive. It excludes frontend source folders, tests, environment files, and developer instructions from the installed UI. Ordinary users do not browse source files while installing or running Mother.

ASAR is packaging, not encryption or digital rights management. A device owner or a skilled reverse engineer can inspect JavaScript and installed resources. Never place API secrets or credentials in the shipped application. It is impossible to guarantee that an owner cannot inspect software running on their own device.

Mother uses the stable secure application origin `mother://app`, so browser memory is retained across application launches even though its internal local server gets a different random loopback port. App updates should preserve that origin. Uninstalling defaults to preserving app data; clearing system application data or browser storage can still remove memory. Keep explicit portable-memory backups.

## Desktop security design

The renderer is sandboxed with context isolation and no Node integration. Production developer tools are disabled. A restrictive Content Security Policy rejects remote scripts, frames, and network access. External navigation is blocked; only fixed official help/download pages can open in the system browser.

The main process proxies its private `mother://app` scheme to a loopback-only server and injects a random per-session token. That token is never returned to JavaScript, saved in memory exports, or included in logs. Backend desktop-token middleware is required to protect local APIs. App-specific external connection routes use their own authorization and connection tokens.

The preload bridge exposes only system information, the official Ollama download action, help, and a user-visible native project-folder picker. It has no generic shell, filesystem read, arbitrary IPC, or arbitrary URL-opening method. A selected folder path does not by itself authorize writes or code execution; the project connector must still enforce its own access rules.
