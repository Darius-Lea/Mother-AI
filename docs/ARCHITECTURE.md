# Architecture and capability boundaries

## Runtime

The React application renders Mother using Three.js and provides conversation, reviewed knowledge, portable memory, and local security tools. The Node/Express backend provides controlled dataset inspection and calls a local Ollama process. Vite proxies API requests during development; Express serves the built application in production.

The initial design uses one local operator. There is no multi-user login, tenant isolation, public hosting authentication, or remote execution agent. Bind to localhost unless you deliberately configure a trusted network. Public hosting requires a separate authentication and transport design.

## Three-dimensional character

The avatar is a procedural graphic assembled from geometry, particles, and light effects. Animation changes visual states such as assembly, listening, thinking, speaking, and gestures. Moving a hand in the rendered scene does not control a physical device. Voice output, rendering, language inference, and tool access are separate systems.

## API

- `GET /api/health` checks the backend.
- `GET /api/models` discovers models from local Ollama.
- `POST /api/chat` sends validated conversation messages to the chosen local model; it returns an explicit error if that model or service is unavailable.
- `POST /api/datasets/inspect` accepts a supported public HTTPS source URL, checks the destination, bounds the download, and returns preview metadata and a SHA-256 fingerprint. Inspection does not automatically approve the source.

These endpoints are a starting interface, not universal app or hardware support. An integration adapter must declare what it can access, authenticate appropriately, validate inputs, obtain necessary permissions, and report real outcomes. Treat model output as untrusted data rather than authorization to execute operations.

## Memory and learning

Versioned browser memory contains the supported profile, conversation records, reference collection, feedback, and settings. Imports validate the schema and size instead of merging arbitrary object keys. Portable export is explicit and readable JSON.

Reference retrieval selects bounded, relevant excerpts. Retrieval augments a prompt; it does not modify model weights or guarantee the truth of a source. User approval is a provenance and consent checkpoint, not a factuality certificate. Source text can contain deceptive instructions even when fetched from a public HTTPS endpoint.

User feedback is data for review. Actual neural training, dataset deduplication, poisoning resistance, holdout evaluation, rollback, and model distribution are separate future work. No background retraining or autonomous self-modification occurs in this foundation.

## Portability and offline behavior

The application shell can be cached by the production service worker after an initial visit. API calls are not faked or served from a success cache. Offline app access does not imply that an unavailable model or server is running. Browser and device speech capabilities differ.

Portable memory travels through export/import. Running the full server and neural inference on another device requires compatible software and sufficient resources. A USB drive can carry files; it does not make a desktop process executable on every phone, tablet, car, or embedded system. Wi-Fi access and Bluetooth pairing require actual device support and authorization.

## Security tools

SHA-256 hashing runs in the browser with Web Crypto. Source review checks a bounded text input for selected risky patterns and returns line numbers and recommendations without repeating detected credentials. No supplied source code is executed. Both tools have deliberate limits and make no claim of complete malware detection, penetration testing, or proof of security.

## Future development

Good next increments are authenticated integration adapters, a separately evaluated local model choice, richer avatar rigging, user-controlled memory management, and a transparent training-data review workflow. Keep working capabilities distinct from aspirational chart claims such as unrestricted access, universal hardware compatibility, or being the most powerful intelligence.
