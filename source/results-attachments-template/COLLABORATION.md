# Task, material and result contract

Use external assignment mode: store necessary task metadata and selected file identifiers, never a whole-project mirror. Codex sends necessary text in the native desktop message and selected original files through the same private attachment service.

Chat returns needs_materials with the purpose and known relative path/line range when content is absent. Codex reads within the existing authorized material directory and supplies a new revision of the same task. Chat has no local filesystem reader.

materialsRead source is direct or attachment. Direct text records the declared whole-file version and the supplied range; do not claim independently verified unseen lines. Attachment evidence includes the exact attachmentId and hash. Original bytes, task/revision and assignment receipt are checked by the server; seeing metadata is not proof the reviewer processed the file.

Every tool response includes channel identity: HTTPS MCP address and a platform-authenticated principalId. Typed attachment output schemas declare this field. The Sites owner account ID and Site-scoped principalId are distinct. Codex stores only credential-free account profiles, pins each packet to its account/service/Chat, and checks native owner-private access plus the actual MCP connection before sending. All tool families must match the selected service.

Results and receipts are immutable and account-isolated. Completion covers the declared review only. Downloads require full byte count and SHA-256 verification; delete both input and result attachments after completion and confirm denial. Preserve unresolved task state on timeout or uncertain sending; resume without another message.
