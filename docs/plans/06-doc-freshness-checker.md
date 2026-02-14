# Doc Freshness Checker

**Priority:** 6
**Inspired by:** OpenAI Harness Engineering — "doc-gardening" agent for stale documentation
**Status:** Spec

---

## Overview

Add a documentation freshness detection system to Synk. The checker scans a project's docs for references to code that has changed since the doc was last updated, broken cross-links between documents, and files that haven't been touched in a configurable time window. Results are surfaced as a "Doc Health" indicator in the sidebar and drawer.

This prevents the "attractive nuisance" problem where agents follow stale instructions and produce wrong code.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where do results display? | Sidebar "Docs" indicator + drawer "Docs" tab for details |
| What directories are scanned? | Configurable, defaults to `docs/`, `.synk/`, `README.md`, `CLAUDE.md`, `AGENTS.md` |
| Scan trigger | On project open + manual "Rescan" button + optional periodic (every 4 hours) |
| Freshness threshold | Configurable, default 30 days since last modification |
| What counts as "stale"? | Doc references code files modified after the doc, or doc not updated in threshold period |
| Fix workflow | User clicks "Fix" → opens a session pre-prompted to update the doc |

---

## Staleness Detection Strategies

### 1. Modification Date Comparison
- Compare doc's last modified date against the source files it references
- If source files changed after the doc, flag as potentially stale

### 2. Code Reference Checking
- Scan docs for references to file paths, function names, type names, module names
- Check if those references still exist in the codebase
- Flag broken references (file moved, function renamed, type deleted)

### 3. Cross-Link Validation
- Find markdown links between docs (`[see architecture](./ARCHITECTURE.md)`)
- Verify target files exist
- Flag broken links

### 4. Age-Based Staleness
- Flag any doc not modified within the configured threshold
- Lower threshold for docs in active development areas

---

## Data Model

### New type: `DocHealthReport`

```ts
type DocHealthReport = {
  projectPath: string;
  scannedAt: string;
  overallHealth: 'healthy' | 'warning' | 'stale';
  totalDocs: number;
  staleDocs: number;
  brokenLinks: number;
  brokenReferences: number;
  items: DocHealthItem[];
};

type DocHealthItem = {
  filePath: string;                  // Relative path to the doc
  lastModified: string;             // ISO timestamp
  health: 'fresh' | 'aging' | 'stale';
  issues: DocIssue[];
};

type DocIssue = {
  type: 'stale-age' | 'stale-reference' | 'broken-link' | 'broken-code-ref' | 'missing-doc';
  severity: 'warning' | 'error';
  message: string;                   // Human-readable description
  details: {
    referencedPath?: string;         // The path/name that's broken
    referencedFrom?: string;         // Line in the doc containing the reference
    lastSourceChange?: string;       // When the referenced source last changed
  };
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/doc_health.rs`

- `DocHealthChecker` struct:
  - Configurable scan directories and thresholds
  - Caches results between scans
- `scan_project(project_path, config) -> DocHealthReport`
  - Discovers all markdown/text doc files in configured directories
  - Runs all detection strategies
  - Aggregates into a health report
- `check_age_staleness(doc_path, threshold_days) -> Vec<DocIssue>`
  - Compares file modification date against threshold
- `check_code_references(doc_content, project_path) -> Vec<DocIssue>`
  - Extracts file paths, function names, type names from doc content
  - Verifies they exist in the codebase
  - Uses regex patterns: backtick code references, file path patterns, import-like references
- `check_cross_links(doc_path, doc_content) -> Vec<DocIssue>`
  - Extracts markdown links `[text](path)`
  - Resolves relative paths and verifies targets exist
- `check_source_drift(doc_path, project_path) -> Vec<DocIssue>`
  - For each code file referenced in the doc, compare modification dates
  - If source is newer than doc, flag as potentially stale

### New commands: `src-tauri/src/commands/doc_health.rs`

- `scan_doc_health` — trigger a full scan
- `get_doc_health_report` — return cached report
- `configure_doc_health` — set scan directories, thresholds, periodic interval
- `dismiss_doc_issue` — mark an issue as "acknowledged" (don't re-flag)

---

## Frontend Changes

### Sidebar Indicator

- Small health badge on a "Docs" section or near the project name
- Green dot: all docs healthy
- Yellow dot: some docs aging (approaching threshold)
- Red dot: stale docs or broken references detected
- Hovering shows: "3 stale docs, 1 broken link"

### Drawer Tab: "Doc Health"

- **Summary bar:** "12 docs scanned — 9 fresh, 2 aging, 1 stale"
- **Issue list:** grouped by severity (errors first, then warnings)
  - Each issue shows: doc file path, issue type icon, description
  - Expandable detail: shows the specific reference and what's wrong
  - **"Fix" button** per issue: opens a new session with a prompt like:
    ```
    Update the documentation in docs/ARCHITECTURE.md.
    The file references `src/core/auth_manager.rs` which was renamed to
    `src/core/authentication.rs` on 2026-02-10. Update all references
    to reflect the current codebase structure.
    ```
  - **"Dismiss" button:** acknowledges the issue, won't re-flag until next change
- **"Rescan" button** in the header
- **Filter:** by issue type, by directory

### Settings

- Doc directories to scan (multi-select or path input)
- Staleness threshold (days, default 30)
- Periodic scan interval (hours, default 4, or "manual only")
- Auto-scan on project open (toggle, default true)

---

## Edge Cases

- Doc intentionally references historical code (e.g., changelog) — dismiss function handles this
- Very large docs directory — scan in background, show progress
- Doc references code in external repos — skip external references, only check local
- Binary files in docs/ (images, PDFs) — skip, only scan text/markdown files
- No docs at all — show "No documentation found. Consider adding a README.md" with a create button
- Rapid code changes — debounce re-scans, don't re-scan on every file save

---

## Success Criteria

- [ ] Full doc scan completes in <10 seconds for typical projects (20-50 doc files)
- [ ] Broken code references are detected with >90% accuracy
- [ ] Broken cross-links are detected with 100% accuracy
- [ ] Sidebar health indicator updates after each scan
- [ ] "Fix" button produces a useful, actionable agent prompt
- [ ] Dismissed issues don't reappear until underlying conditions change
