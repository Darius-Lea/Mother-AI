# Local neural-runtime validation

The current cloud instance now has the official **Ollama 0.40.11** CPU runtime installed outside the checkout at `/workspace/.mother-runtime`. Its server responds at `127.0.0.1:11434` and reports the expected version. This is real runtime detection, not a mocked response.

The official Linux AMD64 release archive was downloaded over verified HTTPS from the Ollama GitHub release. Its SHA-256 matched the separately published `sha256sum.txt` entry:

```
7bedab90dd122661be78798e9f0edf37fccf0cccf2699d2c58ea1a3afdc04b6d
```

The retained installation contains the binary and CPU libraries. CUDA and Vulkan directories were removed because this machine uses CPU inference. Required upstream license notices remain. The large verified download archive was removed after extraction to save space.

## Current remaining blocker

The official `qwen2.5:1.5b` manifest is accessible and identifies a 986,048,512-byte model layer. Its actual download redirects from `registry.ollama.ai` to:

```
dd20bb891979d25aebc8bec07b2b3bbc.r2.cloudflarestorage.com
```

That destination currently returns **HTTP 403 Forbidden from the managed network proxy**. The unsuccessful pull was stopped after diagnosing the denial. No model is installed, and actual neural inference has **not** been verified yet. The runtime installation is progress; it is not evidence that Mother's brain is ready.

Add that exact model-blob hostname to the environment's allowed domains alongside `ollama.com` and `registry.ollama.ai`, apply the relevant runtime network settings, and retry the model download. No paid API or new credentials are needed. Continue preserving TLS verification and Ollama's model-digest verification.

## Restart the retained runtime

Processes do not survive a new cloud task. Developer startup instructions are:

```sh
OLLAMA_MODELS=/workspace/.mother-runtime/models \
OLLAMA_HOST=127.0.0.1:11434 \
OLLAMA_NO_CLOUD=1 \
OLLAMA_NUM_PARALLEL=1 \
OLLAMA_CONTEXT_LENGTH=8192 \
/workspace/.mother-runtime/bin/ollama serve
```

The official runtime also requires its standard local identity directory, `~/.ollama`. Targeted filesystem permission was granted to create that directory on this machine. No identity-key values were displayed, added to the repository, or copied into setup instructions.

After the remaining domain is allowed, download `qwen2.5:1.5b` through Mother's setup wizard, then confirm it appears in `/api/tags`. Test an actual Mother `/api/chat` request and a short grounded question before describing neural conversation as verified. A 1.5B starter is not a benchmark-equivalent replacement for frontier commercial models.
