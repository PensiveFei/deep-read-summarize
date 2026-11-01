# ASR performance check — 2026-11-01

This check compares the unmodified `6b95206` runner with the transcript-cache/thread/metrics changes. It measures transcription only, excluding video download, deep reading, drafting and independent source review.

## Setup

- Windows, Intel Core i5-12500H (12 cores, 16 logical processors), 16 GB RAM; CPU execution.
- Node 24.19.0, faster-whisper 1.2.1, CTranslate2 4.8.1, PyAV 18.1.0.
- Existing `small` model snapshot `536b0662742c02347bc0e980a01041f333bce120`, int8, Chinese, existing beam/VAD/decoding defaults; model files already downloaded. HF offline mode prevented network/download variation.
- One self-authored Chinese passage, rendered locally by Microsoft Huihui Desktop to a 58.439-second WAV. The passage includes numeric contrasts and negation. No private audio was used.
- Each row starts a separate Node process. The first two use the library's default CPU thread policy; the final row explicitly selects 8. A transcript-cache hit still hashes the input, validates cache identity and publishes a new output.

## Observations

| Run | Wall time | Lazy inference iteration | Text relative to baseline |
| --- | ---: | ---: | --- |
| Original runner | 24.517 s | not instrumented | baseline |
| New runner, forced inference | 23.118 s | 20.184 s | byte-identical |
| New runner, cached, timestamps enabled | 0.098 s | skipped | byte-identical after removing timestamp prefixes |
| New runner, 8 threads, cache disabled | 21.275 s | 18.306 s | byte-identical |

The new forced-inference run spent 0.549 s importing, 1.378 s loading the model, and 0.334 s preparing audio/VAD before consuming segments. The cache-hit call reported zero Python time. Stored segments were rendered with their real times; enabling timestamps did not call Python again.

These are single observations, not a latency distribution or a general speed guarantee. Execution order, OS/model-file caches and machine load can affect the difference between fresh runs. The unchanged default is intentional: this sample does not justify increasing CPU threads for every machine.

The normalized reference CER was 9.852% in all four rows. Normalization keeps Unicode letters/numbers, folds case and removes punctuation; it does not equate spoken number words with digits or traditional with simplified Chinese. The result establishes output preservation on this sample, not accurate listening for all videos. Real speech, noise, accents, mixed languages, long silence and long-form omissions need their own reference set. GPU and batch inference were not tested or enabled by this change.

## Repeating the check

Generate audio from the reference below or use a licensed clip with a reference transcript. Keep the same audio, model snapshot, device, decoding settings and machine load for paired runs. Measure full process wall time and inspect the `metrics` JSON. The `inference` timer consumes the complete lazy segment iterator; timing only the return of `transcribe()` is insufficient.

```bash
# Fresh result and cache population
node scripts/transcribe.js --audio sample.wav --out fresh.txt --refresh-cache
# Same audio, different presentation, no inference
node scripts/transcribe.js --audio sample.wav --out timestamped.txt --timestamps
# Thread comparisons must bypass the cache
node scripts/transcribe.js --audio sample.wav --out threads4.txt --cpu-threads 4 --no-cache
node scripts/transcribe.js --audio sample.wav --out threads8.txt --cpu-threads 8 --no-cache
```

Check exact text, omissions, numbers, negation and timestamps as well as aggregate error rates. Keep cold environment/model download, fresh inference and transcript hits separate. Gather multiple representative clips and repeated runs before making a broader performance claim.

## Self-authored reference

今天讨论怎样检查学习笔记的准确性。第一，完整的音频转写不能只保留开头，也不能把视频简介当成全文。第二，数字和否定句需要特别检查。实验用了五十个样本，不是十五个样本；正确率是百分之九十二，而不是百分之九十七。第三，模型下载到磁盘以后，处理新的音频仍然需要推理。重复处理同一份音频时，可以验证内容哈希并复用逐字稿。第四，缓存命中以后，笔记仍然需要精读和独立核验，不能直接宣布质量通过。最后，请保留每一段的真实时间位置，遇到不确定的术语时明确标记，不要编造。
