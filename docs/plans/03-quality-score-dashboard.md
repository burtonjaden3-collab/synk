# Quality Score Dashboard

**Priority:** 3
**Inspired by:** OpenAI Harness Engineering — `QUALITY_SCORE.md` per-domain grading
**Status:** Spec

---

## Overview

Add a quality scoring system that grades each domain/module of a project on criteria like test coverage, code quality, documentation completeness, and known issues. Scores are displayed on Synk's Home Screen dashboard and tracked over time. This serves dual purpose: internal practice for Synk development AND a user-facing feature.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where do scores display? | Home Screen dashboard (existing stats area) + optional drawer tab |
| How are scores generated? | Agent-driven analysis — user triggers a scan, or it runs on schedule |
| Scoring scale | A through F letter grades, each with a numeric score (0-100) |
| What gets graded? | User-configurable modules/domains. Auto-detected from directory structure |
| Score persistence | `.synk/quality-scores.json` in project root — versioned with the project |
| History tracking | Each scan appends to a history array, enabling trend visualization |

---

## Scoring Criteria

Each module is graded across these dimensions (weights configurable):

| Criterion | Weight | How Measured |
|-----------|--------|-------------|
| Test Coverage | 25% | Presence and ratio of test files to source files |
| Code Quality | 25% | File size limits, function complexity, lint violations |
| Documentation | 20% | README/docs presence, inline comments ratio, doc freshness |
| Known Issues | 15% | Open TODOs, FIXMEs, HACK comments in the module |
| Architecture | 15% | Dependency direction compliance, import structure |

### Grade Scale

| Grade | Score Range | Meaning |
|-------|------------|---------|
| A | 90-100 | Excellent — production-ready, well-tested, well-documented |
| B | 75-89 | Good — minor gaps, generally solid |
| C | 60-74 | Acceptable — notable gaps, needs attention |
| D | 40-59 | Poor — significant issues, should be prioritized |
| F | 0-39 | Critical — major problems, blocking quality |

---

## User Flow

1. User opens Synk and navigates to Home Screen
2. Dashboard shows a "Project Health" card with overall grade and per-module breakdown
3. User clicks "Run Quality Scan" (or it runs automatically on project open)
4. Synk spawns a background agent task that:
   - Discovers modules from the directory structure
   - Analyzes each module against the scoring criteria
   - Produces a structured JSON report
5. Results populate the dashboard:
   - Overall project grade (weighted average)
   - Per-module grade cards with mini bar charts
   - Trend arrows (up/down/stable vs last scan)
6. User clicks a module card to see detailed breakdown:
   - Score per criterion
   - Specific issues found (e.g., "3 files exceed 500 lines", "No tests found for git_manager.rs")
   - Suggested improvements
7. User can click "Fix This" to open a session pre-prompted with the improvement task

---

## Data Model

### New type: `QualityScore`

```ts
type QualityScore = {
  projectPath: string;
  lastScanAt: string;                 // ISO timestamp
  overallGrade: Grade;
  overallScore: number;               // 0-100
  modules: ModuleScore[];
  history: QualityScanResult[];       // Previous scans for trends
};

type ModuleScore = {
  name: string;                       // e.g., "session_manager", "sidebar", "git"
  path: string;                       // Relative path to module root
  grade: Grade;
  score: number;                      // 0-100
  criteria: CriterionScore[];
  issues: QualityIssue[];
  trend: 'improving' | 'stable' | 'declining';
};

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

type CriterionScore = {
  name: 'test-coverage' | 'code-quality' | 'documentation' | 'known-issues' | 'architecture';
  score: number;                      // 0-100
  weight: number;                     // 0.0-1.0
  details: string;                    // Human-readable explanation
};

type QualityIssue = {
  severity: 'critical' | 'warning' | 'info';
  criterion: string;
  message: string;                    // e.g., "No test files found"
  file: string | null;                // Specific file if applicable
  line: number | null;
  suggestion: string;                 // Actionable fix suggestion
};

type QualityScanResult = {
  scannedAt: string;
  overallScore: number;
  moduleScores: Record<string, number>; // module name -> score
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/quality_scanner.rs`

- `QualityScanner` struct that orchestrates quality analysis
- `discover_modules(project_path) -> Vec<ModuleInfo>`
  - Scans directory structure to identify logical modules
  - Heuristics: directories with multiple source files, Cargo workspace members, React component directories
- `scan_module(module_path, criteria_config) -> ModuleScore`
  - Runs each criterion analyzer against the module
  - Aggregates scores with weights
- `analyze_test_coverage(module_path) -> CriterionScore`
  - Counts test files vs source files
  - Checks for test naming conventions (*_test.rs, *.test.tsx, etc.)
- `analyze_code_quality(module_path) -> CriterionScore`
  - File size analysis (lines per file)
  - Function count per file (rough complexity proxy)
  - Lint marker detection
- `analyze_documentation(module_path) -> CriterionScore`
  - Checks for README, doc comments, .md files
  - Compares doc modification dates to source modification dates
- `analyze_known_issues(module_path) -> CriterionScore`
  - Grep for TODO, FIXME, HACK, XXX, WARN comments
  - Count and categorize
- `analyze_architecture(module_path) -> CriterionScore`
  - Import/dependency analysis
  - Circular dependency detection
- `save_scores(project_path, scores)` — writes to `.synk/quality-scores.json`
- `load_scores(project_path)` — reads from `.synk/quality-scores.json`

### New commands: `src-tauri/src/commands/quality.rs`

- `run_quality_scan` — triggers a full project scan
- `get_quality_scores` — returns current scores
- `get_quality_history` — returns historical scores for trend charts
- `configure_quality_criteria` — adjust weights and thresholds

---

## Frontend Changes

### Home Screen — Dashboard Stats

Extend the existing dashboard stats area with a "Project Health" card:

- **Overall grade badge** — large letter grade with color (A=green, B=blue, C=yellow, D=orange, F=red)
- **Module grid** — small cards for each module showing name + grade + trend arrow
- **"Run Scan" button** — triggers a new quality scan
- **"Last scanned: 2h ago"** timestamp

### Quality Detail View

Clicking a module card opens a detail panel (modal or slide-over):

- Bar chart of criterion scores
- List of issues grouped by severity
- "Fix This" button per issue — opens a new session with a pre-built prompt targeting that issue
- Trend chart showing score over last N scans

### Settings

- Quality criteria weights (sliders)
- Auto-scan on project open (toggle)
- File/directory exclusion patterns

---

## Edge Cases

- New project with no tests — score low but don't penalize unfairly; show "Getting Started" guidance
- Very large project — scan in chunks, show progress bar
- Module detection is wrong — allow user to manually define module boundaries in `.synk/config.json`
- No previous scan history — show "No trend data" instead of trend arrows
- Mixed language project — adapt criteria detection per file type

---

## Success Criteria

- [ ] Quality scan completes for a typical project (50-100 files) in under 30 seconds
- [ ] Scores are reproducible — same codebase produces same scores
- [ ] Dashboard shows overall + per-module grades at a glance
- [ ] Trend tracking shows meaningful changes over 5+ scans
- [ ] "Fix This" button creates a useful, targeted agent prompt
- [ ] Scores persist in `.synk/quality-scores.json` and are readable by other tools
