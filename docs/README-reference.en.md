# Workflow and configuration reference

[Back to the English README](https://github.com/PensiveFei/deep-read-summarize/blob/main/README.en.md) · [中文参考](README-reference.zh.md)

This page retains the full workflow, configuration, transcription and extension details. Use the README for installation and first use; the main agent must save the note returned by the workflow.

## Structure

```
Input (link or file path)
  │
  ▼
Parser registry ── book / paper / video / web
  │
  ▼
Wave 1  Fetch content → write temp file → build chunk plan
  │
  ▼
Wave 2  N sub-agents deep-read chunks in parallel (Map)
  │
  ▼
Wave 3  Merge draft + quality check (Reduce)
  │
  ▼
Markdown note
```

Three waves, normally N+3 sub-agent calls (fetch, N chunk reads, draft, and quality check). In `auto` mode, ambiguous PDFs, unfamiliar web pages, and text inputs require one additional lightweight classification call. An explicit `type` skips classification.

`auto` routes recognized video links, arXiv paper links, and ebook extensions directly to their parsers; columns, channels, and help pages on those sites still require classification. PDFs are classified as books or papers from their content. Failed classification returns `stage: "detect"` and asks for an explicit type. `options.tempDir` is a temporary root: each call creates its own `run-*` subdirectory, keeping fetched text, audio, and transcripts separate from other tasks.

Chunk plans are sorted, duplicate ranges trimmed, and gaps filled. Plans above `maxChunks` merge adjacent ranges instead of discarding the document tail. The fetch agent runs a bundled helper to propose character-balanced whole-line boundaries from the saved source, preferring nearby paragraph boundaries when balance remains close. Missing or invalid results fall back to line balancing. Character counts are a workload approximation, not token counts, and a single long line is not split. The returned `coverageComplete` indicates coverage of all declared lines based on a valid `totalLines`; without a line count, known ranges are retained, `qualityPassed` is set to `false`, and the coverage uncertainty is reported.

Quality checks combine code and source review. Code validates the supplied scalar/list frontmatter template, required sections, and length (CJK characters plus other words, excluding metadata, code blocks, HTML comments, and link URLs). A separate reviewer reads the current source file and returns per-chunk excerpts and line-bound evidence for verbatim quotations in section 4. A bare `pass: true` cannot override these checks. `qualityChecks` exposes the gates, and `qualityEvidence` exposes the source path and evidence. Source authenticity still depends on the reviewer's actual source reading; uncertainty fails the gate. Empty, rejected, or structurally degraded repairs retain the preceding usable note.

Direct workflow options are strict: `minWords` is an integer in 1–100000, `maxChunks` is a positive integer (values above 12 are capped), `readConcurrency` is an integer in 1–12, and `maxRetries` is an integer in 0–3. Invalid values and unknown keys fail before work begins. Plugin profile configuration instead warns per invalid field and uses its default, preserving host startup.

```
parsers/         Parsers for each input type, dispatched by type
  book.js        Books: PDF/EPUB/MOBI text extraction, chapter chunking
  paper.js       Papers: arXiv/PDF/HTML structure detection
  video.js       Video: subtitles first, optional transcription, with fallback on acquisition failure
  web.js         Web pages: main-text extraction
  index.js       Registry: parser discovery and fallback
schemas/         JSON Schema for the output contract (injected into the script by workflow.js - single source of truth)
scripts/         lint (incl. line-ending/whitespace hygiene), security checks, cross-platform transcription bootstrap
lib/             Small standalone helpers
  cache.js         input fingerprint and idempotency records (for callers driving the workflow themselves -- the
                   workflow sandbox has no filesystem, so it cannot use this)
  workflow-script.txt  the workflow script body (plain text: read and edit it directly, no escaping involved)
tests/           tests and validation scripts (**not published to npm**, repo only)
workflow.js      the workflow meta and assembly logic (parser inlining, schema injection)
```

> The script body lives in `lib/workflow-script.txt` on purpose: this file was corrupted twice by "escaping on top of escaping". It is plain text now, so reading and editing it needs no encoding step.

To override or add a parser, use the package's `custom-parsers/` directory (included in npm packaging), or set the plugin-level `config.customParsersDir` to your own directory. This is not a workflow option. Per-profile directories remain isolated, and rebuilding skill content uses the current registry, including programmatic registrations. Parsers expose `name`, `types`, and `buildPrompt(input, opts)`; registered types are inlined into the workflow and its schema.

File parsers bundle their CommonJS modules and literal relative `.js`, `.cjs`, and `.json` dependencies, preserving module constants, helpers, method shorthand, and cycles. Acorn parses JavaScript during script construction and is installed automatically by npm; it does not run in the workflow sandbox. Node built-ins, external packages, and dynamic `require`/`import` are unsupported in sandbox parsers and fail at build time. Programmatically registered functions must be self-contained; use a file parser for module closures.

---

## Usage

The `deep_read_summarize` tool takes these parameters directly. On older hosts, use them as workflow args with the skill's meta + script:

```jsonc
{
  "input": "https://arxiv.org/abs/2307.09042",  // link or file path
  "type": "auto",   // auto | book | paper | video | web
  "options": {
    "minWords": 2500,
    "fastMode": false,        // true skips sections 5-7, faster
    "maxChunks": 4,           // chunk limit, 1-12
    "readConcurrency": 3,     // concurrent chunk reads and reviews, 1-12
    "parallelQuality": false, // opt in to parallel source review; default retains original review
    "readCache": false,        // plugin tool only: opt in to cross-run read caching
    "readCacheIdentity": "",   // required when enabled: provider, pinned model version and settings
    "transcribe": true,       // video: auto local transcription (faster-whisper) when no subtitles; false skips it — see Video
    "whisperModel": "small",  // video ASR tier: small | base | medium
    "language": "zh",         // video ASR language: use "en" for English-only videos
    "device": "cpu",          // ASR device: cpu (default) | auto | cuda; auto/cuda needs a CUDA runtime and falls back to cpu
    "cpuThreads": 0,          // 0 keeps library defaults; 1-64 allows hardware-specific tuning
    "transcriptCache": true,  // reuse a verified local transcript for matching audio and settings
    "maxRetries": 0,          // quality-check retries (default 0 = no retry; retrying is noticeably slower)
    "frontmatter": "obsidian", // key set: obsidian (default, for Dataview) | generic (drops the keys Hugo reserves) | minimal
    "requireCitations": true, // whether key conclusions must carry citations
    "includeTimestamps": false,
    "outputDir": "./output",    // note output directory (can point at your Obsidian vault or a static-site content folder)
    "tempDir": "./.tmp"        // temp file directory
  }
}
```

Examples:

| Type | input |
|------|-------|
| Paper | `https://arxiv.org/abs/2307.09042` |
| Book | local path, e.g. `~/books/xxx.pdf` |
| Video | `https://youtube.com/watch?v=xxx` |
| Web page | `https://example.com/article` |

The returned `filePath` suggests a location under `options.outputDir` (default `./output`), with the filename taken from the content title. The workflow does not write the note: the main agent must save it.

### Frontmatter profiles (`options.frontmatter`)

The default is `obsidian`, with the same keys as earlier versions and safely quoted scalar/list values. Profiles exist because `type`, `aliases` and `url` are **reserved keys in Hugo** with different meanings -- dropping an Obsidian note into Hugo changes how the page renders, rather than adding a few harmless fields.

| Key | `obsidian` (default) | `generic` | `minimal` |
|---|---|---|---|
| `title` | yes | yes | yes |
| `aliases` | yes | -- | -- |
| `author` / `year` | yes | yes | -- |
| `type` | yes | -- | -- |
| `docType` | -- | yes | -- |
| `url` | yes | -- | -- |
| `sourceUrl` | -- | yes | yes |
| `tags` | yes | yes | yes |
| `created` | yes | -- | -- |
| `date` | -- | yes | yes |
| `status` | yes | yes | -- |

Why `generic` renames things:

- `type` in Hugo selects the **layout** (`type: video` makes it look for `layouts/video/`)
- `aliases` in Hugo is **a list of old URLs that redirect to this page**
- `url` in Hugo **overrides the page's own path** -- the source link would become the article's permalink
- `date` is the time key both Hugo and Jekyll understand; `created` is just a custom field

An unknown value is fatal rather than silently ignored, matching how `type` is handled.

### Video sources and transcription

The workflow prefers available subtitles and attempts transcription by default when subtitles are unavailable. Set `options.transcribe: false` to skip transcription. Acquisition or transcription may fail or be incomplete; description-only output is disclosed and cannot qualify as a complete video deep-read. Both subtitles and transcription may contain errors, so check important content against the audio.

**Transcription toolchain**: `uv` provisions **Python 3.12** and installs **`faster-whisper==1.2.1`** from the Tsinghua mirror; models use `HF_ENDPOINT=https://hf-mirror.com` and the local cache. Healthy cached environments run directly without requiring uv or a separate Python import probe. Actual interpreter and dependency versions are recorded in the cache's `runtime.json`; Python patch releases, uv, and all transitive dependencies are not fully pinned. PyAV decodes audio without a separate ffmpeg. All three platforms use `node scripts/transcribe.js --audio <file> --out <txt>`. CPU is the default; `options.device: "auto"` can try a supplied CUDA runtime and falls back to CPU. Cache roots are `%LOCALAPPDATA%\deep-read-summarize` on Windows, `~/Library/Caches/deep-read-summarize` on macOS, and `$XDG_CACHE_HOME/deep-read-summarize` on Linux (falling back to `~/.cache`). Python provisioning tries a mirror and then direct GitHub; `DRS_UV_PYTHON_MIRROR` overrides it, with an empty value selecting direct downloads.

> ⚠️ **The first transcription downloads the model (small ≈ 484 MB, via hf-mirror, not GitHub) and may take a few minutes**. Later runs reuse model files; new audio still requires full inference. Only a verified transcript cache hit skips inference. **Only subtitle-less videos trigger transcription** (subtitled videos use their subtitles directly).

**Transcript cache and threads**: `options.transcriptCache` defaults to true. Keys include the audio SHA-256, managed local model snapshots, installed dependencies, and decoding settings. Canonical segments retain real start/end times, so changing timestamp presentation does not repeat inference. Changed content/configuration/models/dependencies, custom local model directories, unknown environments, corrupt entries and expired entries bypass reuse. Cache lookup uses the existing local snapshot and does not check for upstream model updates online. Entries live under `transcripts-v1` in the cache root: 8 MiB per entry, 128 MiB total, 30-day validity, pruned on writes. Audio is not stored, and reading/source review still runs.

`options.cpuThreads` accepts integers 0–64. The default `0` preserves the library's CPU thread policy. Compare 4/6/8 on the same audio; more threads are not necessarily faster. CLI controls:

```bash
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --cpu-threads 8
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --refresh-cache
node scripts/transcribe.js --audio sample.m4a --out transcript.txt --no-cache
node scripts/transcribe.js --clear-cache
```

`--clear-cache` removes only transcripts, retaining models and Python. `--refresh-cache` forces inference and updates the cache; `--no-cache` disables reads and writes. Successful calls print one `metrics` JSON line with `cacheHit`, actual device, audio duration, and milliseconds for hashing, environment preparation, dependency installation, Python, publication and total time. Misses also include import, model loading, preparation (including decoding/VAD), and complete lazy-segment iteration. Hits do not reuse previous inference timings.

The note's `qualityPassed` checks the note against acquired text; it does not establish ASR accuracy. ASR changes still need audio/reference comparisons for errors, omissions, numbers, negation and timestamps.

Source type is reported in the `[source]` run log and returned `textSource`. A note based on incomplete source material also contains a visible limitation.

## Factors affecting results and privacy

- Model, input length and format, selected sections, concurrency and network affect time, cost and output. Scheduling simulations are not real LLM speedup measurements.
- ASR runs locally, but deep reading uses the model configured in DSH. When using a cloud model, extracted text, subtitles, note content and related context may be sent to the model provider. Temporary source files, transcripts and optional caches may remain on disk.
- Scanned documents usually need OCR first; formulas, tables and images can affect extraction. Video captions and speech may differ.

## Failures and degradation

Configuration errors such as missing input or invalid options abort execution. Acquisition or drafting failures return a failure stage; an individual failed chunk may leave a draft with a marked gap, which must not be treated as a complete note. `qualityPassed` reflects program checks and the independent review agent; it does not prove all facts or ASR output correct.

## Faster runs with the same quality gates

- Prefer `deep_read_summarize` on supported hosts: the model submits parameters instead of reproducing the entire workflow script. Older hosts retain the existing route.
- The plan covers all known source lines; actual read success and source completeness still need review. By default up to three reading tasks run concurrently, and each free slot immediately starts another task. Character-balanced chunks are used when available; otherwise the workflow balances by line count.
- Independent source review remains enabled. With `parallelQuality: true`, source chunks and all quotations are checked in parallel, with a separate global terminology and language review; the original review is the default. Missing line counts, failed reads, and description-only video sources cannot be fixed by rewriting the draft, so those states no longer consume full repair loops.
- Video `textSource: "desc"` is explicitly degraded and cannot pass as a complete deep read. Bilibili `p` selects the matching CID, part title, and duration.
- Returned `timings` reports stage durations in milliseconds; `readTimings` reports each chunk’s line range, duration and success. Compare the same sources, model, output size, and quality gates; scheduling simulations are not real LLM speedup measurements.
- `readConcurrency` controls concurrent chunk reads without changing the chunk plan or quality review requirements; it also limits concurrent review tasks when `parallelQuality` is enabled. It defaults to 3. When at least four chunks exist and the host supports it, try 4 and compare total time, throttling and failures; higher concurrency is not always faster.

**Cross-run read caching** is disabled by default and supported only by the `deep_read_summarize` plugin tool, not direct workflow calls. Set `readCache: true` and provide `readCacheIdentity` containing the provider, pinned model version and all output-affecting settings. The host cannot verify that identity; change it when the model or settings change. The cache matches source content, chunk prompt and identity, writes only after quality passes, and still performs independent source review on hits. `readTimings.cacheHit` reports hits. Entries are plaintext under `tempDir/.read-cache-v1` and may contain source excerpts; they expire after 30 days, are capped at 64 MiB total and 1 MiB per entry, and can be deleted by removing that directory.

Defaults preserve small/int8, existing decoding settings, output length and independent source review. Transcript caching speeds up repeated audio; new audio can be profiled and tuned with CPU thread settings. Persistent ASR workers and batch inference require separate benchmarks and are not enabled automatically.

## Cost

Token use depends on document length, chunk count, and output size. Source review reads the document again, and each repair round adds a repair and a review call. `fastMode` reduces output sections; reducing `maxChunks` limits agent count while preserving coverage of known line ranges, which does not prove the source was acquired in full.

Programmatic `lib/cache` callers: URL trailing slashes, explicit empty queries, and fragments are preserved because they may select different content. New fingerprints are isolated from old records, so an upgrade can cause one reprocessing pass. Callers must still verify source freshness and configuration before reusing results.

---

## Compatibility

Parts of the host contract were historically checked against **DSH 0.2.0-rc.2** (Node 24). That does not establish compatibility of every newer configuration or real-model result. Two important workflow contract areas are:

| Surface | Current contract | How this repo uses it |
| --- | --- | --- |
| workflow script hooks | `agent()` / `pipeline()` / `parallel()` / `phase()` / `log()` / `args` | only `agent/parallel/phase/log/args`; `agent()` options limited to `label/phase/schema` (the engine accepts only `label/phase/schema/provider/model` and treats anything else as fatal) |
| JSON Schema subset | `type / properties / required / additionalProperties / items / enum / const / oneOf` plus annotation keys | some schemas from the historical implementation passed the host's `assertObjectJsonSchema`; newer schemas still need separate host validation |

Two contract details that bite:

- **The script sandbox has no filesystem, network, timers or `require`** — it coordinates subagents; the caller persists the note.
- **Breaking the schema subset terminates the run** rather than degrading: the engine raises `UNSUPPORTED_SCHEMA` and the whole workflow fails. `npm test` carries a regression for this, including a reverse assertion so the checker cannot pass vacuously.

After upgrading DSH, run `npm test` and `npm run test:node`; if something breaks, cross-reference CHANGELOG.md.

---
