# Included local AI engine

Mother's desktop installer includes the free Ollama runtime. A desktop user
opens the Mother installer, approves the operating system's normal installation
prompt, and opens Mother. No ZIP extraction, terminal, separate Ollama installer,
compiler or package manager is part of that user flow.

On first launch Mother checks whether a compatible Ollama service already runs
on this computer. If it does, Mother reuses it. Otherwise Mother checks her
included engine's files and starts it automatically. The wizard then recommends
an open model for this computer and asks before downloading its weights. Actual
download and verification progress comes from Ollama; the interface does not
simulate successful installation or model replies.

The included runtime is **Ollama 0.40.11**. This does not mean model weights are
included, that a working neural conversation has been demonstrated on every
device, or that an open model matches frontier commercial assistants. Downloads
require internet and storage, and inference speed depends on the model and
hardware. The hosted Render preview and mobile browser companion do not contain
a native inference engine.

| Desktop target | Included engine |
| --- | --- |
| Windows x64 / ARM64 | Official CPU runtime and native dependencies |
| macOS Intel | Official Intel CPU libraries and universal helpers |
| macOS Apple Silicon | Universal helpers and official native MLX/Metal backends |
| Linux x64 | Official CPU runtime and libraries |

Apple Silicon's native backends make that installer larger. Optional CUDA,
ROCm and Vulkan downloads are excluded from these starter bundles. An existing
Ollama installation can provide its own supported acceleration.

## Build provenance

Developers and CI prepare the engine before packaging:

```sh
python3 scripts/prepare-runtime.py --platform linux --arch x64
```

The other supported targets use `--platform win32` or `--platform darwin` and
`--arch x64` or `--arch arm64`. Linux decompression requires `zstd` on the build
runner. Python's standard library handles ZIP and gzip archives on Windows and
macOS. These are build prerequisites, not end-user installation steps.

Preparation uses verified HTTPS for a fixed official release asset, compares
its SHA-256 against both a pinned value and the official `sha256sum.txt`, and
rejects mismatches. It extracts only the selected native files, rejects unsafe
archive paths and link targets, and materializes confined library aliases as
regular files. Upstream dependency notices remain. Ollama's top-level MIT
license is downloaded from the exact source tag with a separate pinned digest
and included as `licenses/OLLAMA_LICENSE`.

The ignored `.runtime/ollama` output contains `manifest.json`, a fixed executable
at `bin/ollama` or `bin/ollama.exe`, native libraries, and notices. The manifest
records platform, architecture, upstream version, source URL/archive SHA-256,
and every retained file's size and SHA-256. Cached output is rechecked before
reuse. The installer copies the complete output to `resources/runtime`.

At launch, `desktop/runtime.cjs` checks version/platform/architecture, fixed
entry-point metadata, every retained file's size/digest, unexpected files, and
symlinks. A missing or changed bundle produces a readable retry/reinstall
message and leaves the visual companion and offline tools available. Neither
the renderer nor a website can provide a command, executable path or download
URL to this manager.

## Process and model ownership

The app-owned engine starts with a fixed `serve` argument, `shell: false`, hidden
Windows console, and localhost-only `127.0.0.1:11434` binding. Cloud features are
disabled for that process. App-owned model weights live in Mother's user-data
`models` directory, separate from the installer. Ollama retains its normal
operating-system user identity location. No home-directory environment override
is used. A reused Ollama installation keeps its own configuration and library.

Readiness requires valid responses from both `/api/version` and `/api/tags`.
Requests and startup have bounded timeouts. Concurrent start requests share a
single operation, retries recheck services that may have disappeared, and
quitting Mother terminates only the engine process Mother started. A separately
installed Ollama service is never terminated by this manager. The application
does not install a background system service or change firewall rules.

## Validation

Runtime tests cover changed bytes, architecture mismatch, injected libraries,
manifest traversal, symlinks, existing-service reuse and disappearance, fixed
spawn arguments/environment, concurrent starts, startup timeout, shutdown races,
and archive path/link rejection.

The Linux build-preparation command was executed against the actual official
release archive. Its pinned SHA-256 matched, yielding 48 files (about 95 MiB;
library aliases are materialized). The resulting bundle passed the same
JavaScript verifier used at application startup. This verifies preparation and
integrity; native installation and actual neural inference are separate checks.
