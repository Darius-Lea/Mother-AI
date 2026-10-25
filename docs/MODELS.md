# Free local intelligence setup

Mother uses an installed open-weight model through Ollama. A larger model, stronger hardware, curated references, and practical tools can improve performance, but none of these steps establishes parity with ChatGPT, Codex, Claude, or another frontier system. No paid API key is required. Model licenses still apply.

## Guided setup

Open **Set up Mother**. The wizard:

1. Explains local inference and its resource requirements.
2. Checks the actual Ollama service on the machine hosting Mother's backend.
3. Offers existing installed models or a conservative selection based on total system RAM.
4. Requests explicit approval before downloading a model.
5. Displays byte counts and status messages from Ollama's real download stream.
6. Confirms the selected name appears in Ollama's installed-model list before allowing completion.

The final step confirms installation, not the quality, speed, or correctness of future answers. Model inference must still succeed when a conversation is submitted. Download failures, missing runtime, unavailable registry access, and cancelled tasks are presented as failures or unavailable capability rather than simulated success.

## Runtime installation

On supported Windows and macOS desktops, **Get the free runtime** opens the official Ollama download page in the normal browser. Complete its normal operating-system installer and open Ollama, then return to Mother and choose **Check again**. Mother does not covertly install executables, bypass system approval, or claim that opening a page completed installation.

On Linux, Ollama's official runtime installation may require a system administrator or the official installation steps. This release does not implement an unattended Linux runtime installer. The Mother desktop package itself bundles the application's own Node/Electron runtime; Ollama and its model are separate.

A phone or tablet viewing Mother is a client of the server host. The status page describes that host's hardware, not the phone. Installing Ollama on a different device will not automatically make it available to Mother's server. The mobile web app does not bundle a native Ollama runtime; connect it to a properly secured compatible host for neural inference.

## Starter model choices

| Model | Main purpose | Approximate download | Minimum system RAM used by setup |
| --- | --- | ---: | ---: |
| `qwen2.5:1.5b` | Small starter; limited reasoning and coding | 1.0 GB | 4 GB |
| `qwen2.5-coder:7b` | Code explanations and drafting | 4.7 GB | 12 GB |
| `qwen3:8b` | General reasoning | 5.2 GB | 12 GB |
| `qwen3:14b` | Larger reasoning model | 9.3 GB | 24 GB |
| `qwen3-coder:30b` | Workstation coding model | 19 GB | 40 GB |

Sizes are estimates for usual quantized variants, not promises. RAM policy leaves some room for context and the operating system; it does not verify GPU memory or guarantee that every eligible model fits under every workload. CPU-only inference may be slow. GPU capability is explicitly reported as unknown, never inferred from CPU count or RAM. Already installed compatible Ollama models can also be selected, including models not in this starter catalog.

## Setup API

The parent app mounts `createModelRouter()` at `/api/setup` behind its own local/desktop administrator authentication.

- `GET /status` returns hardware, actual runtime availability, installed model names, recommendations, and a current download when one exists.
- `POST /pull` with JSON `{ "model": "qwen3:8b" }` starts one approved catalog download after checking runtime, RAM, and whether it is already installed.
- `GET /pull/:id` returns the task's actual state, known byte totals, status, and any error.
- `POST /pull/:id/cancel` with JSON `{}` aborts the progress/download connection initiated by this router.

Only one task runs at a time. A bounded recent history is retained in memory; it is not a durable job queue. Closing the wizard leaves its task running while the server process remains alive. Closing Mother stops that process's progress connection. Ollama may retain downloaded layers; cancellation does not promise removal of partial model files. On restart, inspect installed models before retrying.

Ollama owns model storage and artifact verification. Mother does not disable TLS or checksum validation. Registry or blob-host network access must be permitted by the execution environment.

## Validation and current cloud limitation

`node --test server/models.test.js` exercises unavailable runtime, installed detection, hardware boundaries, allowlisted model names, real NDJSON progress parsing, final installed verification, errors, cancellation, concurrency, and timeout using controlled mocked Ollama responses. These tests do not claim a model was installed or generated a real answer.

In the current cloud setup, official model-download requests previously returned egress HTTP 403. The draft adds official download/registry destinations, but saving a draft does not apply access or install a model. Retry after a meaningful network-policy change and inspect any official redirected blob destinations. No missing API key or paid subscription is implied by this failure.
