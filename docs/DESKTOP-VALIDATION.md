# Desktop preview validation

Validation applies to the existing **1.0.0-preview.1** artifacts built from the pre-Render-fix application sources. These are unsigned previews, not a public production release.

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
- [Run 3](https://github.com/Darius-Lea/Mother-AI/actions/runs/40195081760#artifacts), source `1e6e5c8`: macOS and Linux tests/builds/uploads succeeded. Windows failed at `npm test` before packaging. The current source includes ASAR separator normalization plus a Windows-separator regression test, which must pass in a subsequent Windows build before claiming that issue resolved there.

GitHub artifact downloads require a signed-in GitHub session and are retained for the workflow's configured retention period. A successful artifact build is separate from publishing a public product release or proving installation on the investor's actual computer.
