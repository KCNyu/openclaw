# KCN maintenance package adaptations

The maintenance workflow enables these adapters with
`OPENCLAW_KCN_MAINT_PACK=1`. Prepack builds the runtime, applies the adapters
to temporary copies of the generated bundles, and records the package version,
full commit and output hashes in `dist/kcn-patches.json`. The packed-runtime
check installs the tarball and validates the receipt and all target conditions.

The ordered manifest pins the supported correction version and the selectors
and conditions for each adaptation. New upstream versions need anchor and
behavior review before they can be packaged with this set.

| Adapter | Purpose |
| --- | --- |
| dreaming-narrative-race | Keep parallel dream phases from pruning one another’s session records. |
| dreaming-fallbacks | Try configured fallback models for retryable diary generation failures. |
| dreaming-session-ingestion | Resume ingestion cursors and prioritize recent direct-chat input. |
| dreaming-review | Write ranked promotions to the private review input. |
| vector-knn-oversample | Avoid unused KNN oversampling while retaining underfill widening. |
| hook-relay-exec | Make the relay share the hook process lifetime on POSIX. |
| reply-session-cost | Attach usage to the correct reply and session. |
| cache-hit-pct-exact | Compute cache hit percentage with the unrounded counts. |
| codex-cli-runtime-state | Let CLI metadata discover the pinned Codex plugin without opening gateway state. |
| anthropic-sonnet5-costless | Preserve valid model cost metadata for usage accounting. |
| embedding-threads1 | Bound local embedding CPU and batch size for the desk profile. |
| memory-search-timeout | Allow the local cold search enough time to complete. |
| memory-local-warmup | Preload local embeddings after gateway start. |
| minimax-response-header-timeout | Use a separate response-header budget for MiniMax. |
| minimax-m3x-adaptive-thinking | Keep the pinned MiniMax profile’s supported adaptive thinking value. |

The five host/provider-specific adaptations are included because the KCN
maintenance artifact already targets this desk profile. Keeping them in the
same artifact lets host upgrades verify identity without rewriting packages.
These adapters still use version-pinned bundle anchors. Their supported entry
point is the package build. Host extension installation and rollback remain
outside packaging.
