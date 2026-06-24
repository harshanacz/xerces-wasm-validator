# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-06-24

Full rewrite. v2 is a complete re-architecture with a new API — v1.x code will not
work unchanged. See **Migration** below.

### Added
- `createProjectValidator()` — a reusable, per-project validator backed by an
  in-memory grammar pool.
- In-memory XSD caching: each project's schemas compile **once** into a locked
  `XMLGrammarPool` held in WASM memory and are reused on every validation.
- Per-project isolation — each project keeps its own compiled pool, so the same XML
  can be valid in one project and invalid in another.
- Two-pass validation results: `parseErrors` (well-formedness) and `schemaErrors`
  (XSD rules), each as `{ message, line, column, severity }`.
- `reload()` to recompile a project's pool when schemas change, and `destroy()` to
  free WASM memory.
- Bundled Apache Xerces-C++ license (`LICENSE-APACHE`) and `NOTICE`.

### Changed
- **Breaking:** validation now goes through a `createProjectValidator()` instance
  instead of a one-shot top-level call.
- **Breaking:** result shape is now `{ valid, parseErrors, schemaErrors }`.

### Performance
- After a one-time compile (~22 ms in the bundled benchmark), repeat validations run
  in ~0.04 ms.

### Migration
1. Create one validator per project: `createProjectValidator({ entry, files })`.
2. Pass all dependent XSDs in `files` (keyed by filename) so `xs:import` /
   `xs:include` resolve from memory.
3. Read results from `parseErrors` / `schemaErrors`.
4. Call `destroy()` when a project closes — WASM memory is not reclaimed by the JS GC.

## [1.0.0]

Initial release.

[2.0.0]: https://github.com/harshanacz/xerces-wasm-validator/releases/tag/2.0.0
