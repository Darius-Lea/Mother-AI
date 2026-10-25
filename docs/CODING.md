# Mother code workspace

Mother can open one explicitly selected local project at a time. The desktop app calls the native folder picker through `window.motherDesktop.chooseProjectDirectory()`; its result is `{canceled, path}`; the component also accepts a legacy path string or `null`. Browser users may supply a path on the computer hosting Mother. Selecting a folder is authorization to read its supported, bounded source files, not to execute its contents.

`createWorkspaceRouter({rootDirectory?})` is exported by `server/workspace.js`; mount it at `/api/workspace` behind Mother's administrator/session authentication. Do not mount these routes on a public unauthenticated server. Integration tokens do not grant workspace access.

Endpoints:

- `GET /status`: selected project and limits.
- `POST /open` with `{path}`: explicitly select a real directory and clear old proposals.
- `POST /close` with `{}`: disconnect and discard pending changes/backups.
- `GET /tree`: bounded source listing, excluding known secret/dependency folders and unsupported files.
- `GET /file?path=src/example.js`: UTF-8 contents and SHA-256, limited to 128 KiB.
- `POST /proposals` with `{path, content, expectedSha256}`: create a review preview without changing the file.
- `POST /proposals/:id/apply` with `{}`: explicitly apply an approved change only if the original fingerprint still matches.
- `POST /proposals/:id/rollback` with `{}`: restore the original only if the applied contents still match.

File paths are relative to the selected project. Absolute paths, traversal, symbolic links, hard-linked files, common secret file names and binary/oversized files are rejected. File modes are preserved; writes use a temporary file and atomic rename, with directory/file identity and fingerprint checks immediately before replacement. Linux also pins the parent through an open directory descriptor. Do not use a project directory concurrently manipulated by an untrusted local process: Node does not expose a portable cross-platform filesystem transaction, so this is not an isolation boundary against a hostile process running as the same OS user. Exclusions help prevent accidental disclosure; they cannot identify every secret embedded in ordinary source files.

Proposals and original contents are held only in memory for at most 30 minutes; restarting Mother or disconnecting the project discards them. Version control or a separate backup remains necessary. Mother will refuse restore after another edit rather than overwrite that edit.

The React component `CodeWorkspace({model, onAsk})` calls `onAsk({path, content, prompt})` when the user asks to discuss a file with the selected local model. It does not pretend to generate a change when no model is installed. The editor can review and apply manually prepared code independently. Model discussion is not a test result: this version runs no shell commands, project code, dependency installation, tests or autonomous tool loop. It offers a controlled first coding workflow, not parity with Codex or another frontier coding agent.
