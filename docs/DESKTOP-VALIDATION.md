# Desktop preview validation

These are unsigned **1.0.0-preview.1** previews, not a production release. The earlier package results below are historical; they do not describe the new bundled-engine installer.

## Direct-installer update

- 187 Node checks passed, including archive/runtime integrity, safe extraction, engine lifecycle, catalog validation, publisher failure handling, API isolation, permissions, and existing application functions.
- All 16 browser workflows passed, including automatic engine setup/retry, direct installer selection, unavailable builds, responsive hosted preview, WebGL, references, coding approval/restore and local memory.
- Actual official runtime archive preparation and JavaScript integrity verification passed for Linux x64, Windows ARM64, and Mac ARM64. These cross-platform file checks do not establish native execution.
- Actual source and packaged Linux desktop launches started the included Ollama 0.40.11 engine automatically. Version and installed-model-library requests succeeded. Restricted bridge, session-token enforcement, renderer isolation, and memory after restart also passed.
- The new completed Debian installer is 129,888,040 bytes, with SHA-256 `48f7de61107f9a0cd8341d10589643feaa0c0f2baaaf3a11232a0bc595ca9bbc`. Its package header, build receipt, byte count, and checksum passed catalog verification.
- A developer-only extraction of that exact Debian package also passed the desktop smoke, including automatic engine startup. This checks the distributed package's contents; it does not replace installing it through a native desktop package manager.

Actual language-model inference remains unverified because this cloud environment blocks the model blob download destination. Trusted OS signing/notarization and native end-user installation testing remain unfinished. Successful engine startup is distinct from a downloaded model generating a reply.

## Local package checks

All three local completed-build receipts match the actual package SHA-256:

| File | Size in bytes | Package result |
| --- | ---: | --- |
| `Mother-AI-1.0.0-preview.1-linux-amd64.deb` | 104,936,508 | Completed build; receipt digest matches |
| `Mother-AI-1.0.0-preview.1-linux-x86_64.AppImage` | 105,054,155 | Completed build; receipt digest matches; packaged launch smoke passed |
| `Mother-AI-1.0.0-preview.1-win-x64-portable.exe` | 112,494,884 | Completed portable build; receipt digest matches; native Windows execution untested here |

The Linux and Windows `app.asar` archives each passed syntax checks for all 12 packaged server/desktop JavaScript modules. The 11 runtime entry-point/server files in each archive exactly matched committed source `1e6e5c8` during validation. The earlier concurrent-write ASAR corruption is not present in these packages.

The actual downloadable Linux AppImage was launched with `APPIMAGE_EXTRACT_AND_RUN=1`, which avoids requiring FUSE in this restricted cloud. The same smoke also passed against its unpacked executable. Verified behavior:

- The live window opens the stable `mother://app` origin.
- The real backend health, local-model discovery, app endpoint discovery, and setup-status routes respond through the desktop protocol.
- The isolated renderer has no `require` or `process` access.
- The preload exposes only the intended narrow bridge, with no generic shell/file-read/token API.
- Raw loopback model access receives HTTP 401 without the private desktop session.
- Local storage survives closing and restarting the app.

The cloud smoke uses `--no-sandbox` only as a test-runner argument in this restricted environment. The distributed application configures a sandboxed renderer. These checks do not establish a native Debian package installation, trusted signing, Windows execution, macOS execution, or real neural-model inference.

## Native build workflows

- [Run 2](https://github.com/Darius-Lea/Mother-AI/actions/runs/40194794730#artifacts), source `8bbbdd6`: Windows, macOS, and Linux builds and artifact uploads succeeded.
- [Run 3](https://github.com/Darius-Lea/Mother-AI/actions/runs/40195081760#artifacts), source `1e6e5c8`: macOS and Linux tests/builds/uploads succeeded. Windows failed at `npm test` before packaging.
- [Run 6](https://github.com/Darius-Lea/Mother-AI/actions/runs/40229065175#artifacts), source `2b421f4`: Windows, macOS and Linux completed tests, builds and uploads after the nested Windows ASAR fix.

The new workflow publishes verified EXE/PKG/DEB files to the approved `mother-preview` prerelease channel after all five target builds pass. Internal workflow artifacts are not consumer download links. Publication and a successful build remain separate from proving installation on the investor's actual computer.

## Natural voice and web update

- 231 automated checks passed, plus all 20 browser workflows (16 existing and four new voice/web cases).
- The rebuilt Linux package launched its bundled Ollama engine and generated real, non-silent neural speech through the protected native desktop API. Renderer isolation, private API authentication and saved memory after restart passed.
- The actual native private-browser controls passed isolation, restricted IPC, rejected local links, cleared session cookies and owner-log reading/clearing checks. This managed cloud blocked external page loading in that browser; a normal-network target-device check remains necessary.
- The web reader performed actual successful HTTPS requests to GitHub and read this repository page. Its status identifies the verified public URL and time. Both free search endpoints were blocked in this cloud environment; search fixtures test parsing and failure handling, rather than claiming live search worked here.
- Actual browser WASM and native CPU voice inference produced 4.55 seconds of 24 kHz audio for the included preview sentence. The sample is shipped in the UI. Native speech was also verified inside the packaged Electron application.
- Official download discovery now works through the managed proxy and returned all five real, directly hosted preview installers.

Windows/macOS native installation, trusted signing/notarization, broad website compatibility and language-model inference remain separate verification items. The product is still a first-release preview.
