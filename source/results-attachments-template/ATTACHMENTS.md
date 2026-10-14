# Selected attachment transport

This extends the existing account-private task/result plugin. It does not need a local reader, a temporary tunnel, a new domain, or a file-picker UI.

Both directions use the same stored original bytes, attachment ID, exact task/revision, assignment receipt, size and SHA-256. Authentication remains the platform's site-scoped authenticated user identity; neither scripts nor public HTTP callers can provide a substitute identity.

## Program flow

1. Register an immutable task with the existing publish_assignment tool.
2. Codex chooses necessary files within the authorized task root. scripts/attachment-local.mjs rejects traversal, junction/symlink paths, sensitive filenames, changed files and files over 16 MiB. It computes hashes and supplies 256 KiB chunks to the authenticated host tools through scripts/attachment-host-runtime.js. Bytes stay in program/tool IO, not model text.
3. begin_attachment_upload / upload_attachment_chunk / finish_attachment_upload create and seal an attachment only when original size/hash agree. Identical retries reuse the receipt; conflicting writes cannot replace bytes.
4. Send the existing native Chat message with exact attachment IDs. Chat discovers connected tools without a manual @ request. Images/audio can use native preview_attachment; documents and saved originals use read_attachment_chunk with programmatic decoding. Native preview is limited to 4 MiB.
5. Chat can import a real host-provided file reference through import_attachment. The descriptor declares openai/fileParams; the host-facing tool can accept an absolute local path and convert it to a real FileRef automatically. A path stored in result text alone is not transmission. Network requests are restricted to HTTPS files.openai.com or oaiusercontent.com and its subdomains. Regional origins shaped oai(sdmntREGION).blob.core.windows.net are normalized to sdmntREGION.oaiusercontent.com; they are never fetched directly. The adapter requires an unexpired signed read-only single-blob URL plus caller-measured expected size/hash. This routing was inferred from actual platform regional file references and must be confirmed by the live original-byte hash test. Name prefixes do not prove account ownership. Other Azure accounts are denied. Every redirect is checked and total bytes/time are bounded.
6. submit_task_result optionally references ready result attachmentIds. Source=attachment evidence includes an attachmentId; the server verifies its binding/readiness/hash. This does not prove the reviewer read it.
7. The existing result waiter polls inside one tool program, without model requests on empty polls. Download returned IDs, independently verify full size/hash, then delete attachments. A local download never overwrites an existing file.

## Retention and limitations

Uploads expire one hour after beginning; reads/retries cannot extend expiry. Expired/deleted data is inaccessible immediately. Physical cleanup occurs on subsequent access or explicit deletion; there is no scheduled purge guarantee. The collaboration program must delete task attachments after verified receipt. Small immutable tombstones and text task/result receipts remain.

Live acceptance on 2026-10-14 verified real synthetic PNG/PDF/WAV bytes in Chat, a returned PDF, and an existing generated PNG (2,964,847 bytes) downloaded and independently hashed in Codex. The installed automatic entry uploaded PNG/PDF, sent one native message, waited inside the tool program, downloaded and hashed the returned PDF, and deleted input/result attachments with denied-read checks. No manual application selection or result relay was needed in that connected account. This does not establish export support for every generated type or a fresh friend's account, and Chat actually hearing audio is not verified. No whole project is stored. File previews do not replace original-byte verification. No refresh tokens, temporary file URLs or file bearer credentials are persisted or logged.

## Local checks

Use the existing fixed Node 24 runtime:

- node --test tests/attachments.test.mjs tests/attachment-local.test.mjs
- node node_modules/typescript/bin/tsc --noEmit --incremental false
- existing Site build/package workflow

The dependency helper on this Windows host failed to locate npm's entrypoint. Calling the installed official npm-cli.js with the same install:ci/build scripts succeeded; global approval settings and package install-script approvals were not changed.
