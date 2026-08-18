# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Initial public release structure

## [3.0.0] — 2026-08-18

### Added
- Plugin parser architecture: `parsers/` registry with book/paper/video/web adapters
- JSON Schema structured output constraints (`schemas/index.js`)
- Failure discipline: FATAL (config) vs degradable (content) error classes
- Quality control loop with retry (`maxRetries`)
- Configurable citations (`requireCitations`) and video timestamps (`includeTimestamps`)
- Fixture-driven test suite (`npm test`, 10 tests)
- Quick validation script (`npm run validate`)
- CI workflow (lint + tests)
- cordis.yml plugin tree example

### Changed
- Workflow reduced to 3 serial waves (fetch/chunk → parallel read → merge+QC)
- Subagent count reduced to N+2~3
- Defaults changed to general-purpose: `requireCitations: true`, `includeTimestamps: false`

### Removed
- Standalone quality-check subagent (merged into wave 3 + optional lightweight retry)

## [2.1.0] — 2026-08-18

### Added
- One-click write-to-Obsidian from the draft agent
- fastMode (skip sections 5-7)

## [2.0.0] — 2026-08-18

### Changed
- Merged identify+fetch+chunk into one subagent (3 waves total)
- Removed standalone QC subagent

## [1.1.0] — 2026-08-18

### Fixed
- Long-content overflow: write-to-temp-file + line-range chunking

## [1.0.0] — 2026-08-18

### Added
- Initial deep-reading pipeline (5 serial waves)
- Template prompts for books/papers/videos/web
- Obsidian note template with YAML frontmatter