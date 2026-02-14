# Agent-to-Agent Review Loops

**Priority:** 1 (Highest)
**Inspired by:** OpenAI Harness Engineering — "Ralph Wiggum Loop"
**Status:** Spec

---

## Overview

Enable orchestrated agent-to-agent code review within Synk. When a session produces a diff or PR, the user can request another running session to review it. Feedback flows through Synk's existing Review Panel, and the authoring session can iterate on the feedback — creating an automated review loop that reduces human QA bottleneck.

This is a differentiating feature — no existing tool orchestrates agent-to-agent review through a visual UI.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where does review initiate? | From the Review Panel "Request Review" button, or right-click a session |
| Who can be a reviewer? | Any active agent session (Claude, Codex, Gemini) — user picks which |
| How is the diff delivered? | Synk pipes the git diff + file contents into the reviewer session via PTY stdin as a structured prompt |
| Where does feedback appear? | In the existing Review Panel as inline comments on the diff viewer |
| Can reviews auto-iterate? | Yes — optional "auto-iterate" mode where the author session receives feedback and pushes fixes, then re-requests review until the reviewer approves |
| Max iteration rounds? | Configurable, default 3 rounds |
| Cost guardrails? | Each review round's token cost is tracked; user can set a per-review cost ceiling |

---

## User Flow

1. User has Session A (author) working on a feature branch
2. Session A produces changes — user sees the diff in the Review Panel (or Session A opens a PR)
3. User clicks **"Request Agent Review"** in the Review Panel toolbar
4. A picker shows all other active sessions — user selects Session B as reviewer
5. Synk generates a structured review prompt containing:
   - The full diff (hunks with context)
   - Relevant file contents for context
   - Project standards from `.synk/standards.md` (if it exists)
   - Instruction: "Review this diff. For each issue, output a structured comment with file, line, severity, and suggestion."
6. The prompt is sent to Session B's PTY
7. Synk parses Session B's output for structured review comments
8. Comments appear inline in the Review Panel diff viewer
9. **If auto-iterate is ON:**
   - Synk sends the review comments to Session A with instruction to address them
   - Session A makes fixes and pushes
   - Synk re-requests review from Session B
   - Loop continues until Session B approves or max rounds reached
10. User sees the full review conversation in the Review Panel

---

## Data Model

### New type: `AgentReview`

```ts
type AgentReview = {
  id: string;                    // UUID
  diffSource: 'working-tree' | 'branch' | 'pr';
  authorSessionId: string;       // Session that produced the changes
  reviewerSessionId: string;     // Session performing the review
  status: 'pending' | 'in-progress' | 'changes-requested' | 'approved' | 'error';
  rounds: AgentReviewRound[];
  maxRounds: number;             // Default 3
  autoIterate: boolean;          // Whether to auto-send feedback to author
  costCeiling: number | null;    // Max cost in dollars for entire review
  totalCost: number;             // Accumulated cost across all rounds
  createdAt: string;
  updatedAt: string;
};

type AgentReviewRound = {
  roundNumber: number;
  reviewComments: ReviewComment[];  // Existing type from review_store
  authorResponse: string | null;    // Summary of what the author changed
  cost: number;                     // Cost for this round
  timestamp: string;
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/agent_review.rs`

- `start_review(author_session_id, reviewer_session_id, diff, config) -> AgentReview`
  - Generates structured review prompt from diff
  - Writes prompt to reviewer session's PTY
  - Sets up output parser to capture structured comments
- `parse_review_output(raw_output: &str) -> Vec<ReviewComment>`
  - Parses agent output for structured review comments
  - Supports multiple formats (markdown, JSON, inline annotations)
- `send_feedback_to_author(review_id, comments) -> Result`
  - Formats review feedback as a prompt for the author session
  - Writes to author session's PTY
- `check_review_approval(review_id) -> ReviewStatus`
  - Parses reviewer output for approval/rejection signal

### New commands: `src-tauri/src/commands/review.rs` (extend existing)

- `start_agent_review` — IPC command to initiate a review
- `get_agent_review_status` — Poll review progress
- `cancel_agent_review` — Stop an in-progress review loop
- `configure_review_defaults` — Set max rounds, cost ceiling, auto-iterate

---

## Frontend Changes

### Review Panel Toolbar

- Add **"Request Agent Review"** button (icon: two chat bubbles or robot icon)
- Clicking opens a session picker dropdown showing active agent sessions
- Checkbox: "Auto-iterate until approved" (default: off)
- Number input: "Max rounds" (default: 3)

### Review Panel — Agent Review Mode

- When an agent review is active, show a progress indicator: "Round 1/3 — Reviewing..."
- Review comments render inline on the diff viewer (same as existing human comments)
- Each comment tagged with reviewer session name and agent type badge
- If auto-iterate is on, show iteration progress: "Author addressing feedback..." → "Re-requesting review..."
- Final state: green "Approved" or yellow "Max rounds reached — needs human review"

### Cost Display

- Show per-round and total cost for the review in the Review Panel footer
- Warning if approaching cost ceiling

---

## Review Prompt Template

```markdown
You are reviewing a code diff. Analyze the changes and provide structured feedback.

## Project Standards
{standards_content or "No project standards configured."}

## Diff
{diff_content}

## Instructions
For each issue you find, output a comment in this exact format:

**FILE:** path/to/file
**LINE:** line_number
**SEVERITY:** error | warning | suggestion
**COMMENT:** Your review comment here

If the changes look good with no issues, output:
**APPROVED**

Focus on: correctness, security, performance, adherence to project standards, and maintainability.
```

---

## Edge Cases

- Reviewer session is busy (already processing) — queue the review, show "Queued" status
- Reviewer session dies mid-review — mark review as "error", offer to reassign
- Author session dies during auto-iterate — pause the loop, notify user
- Diff is too large for context — chunk into per-file reviews
- Cost ceiling hit — pause loop, ask user whether to continue
- Circular review (session reviews itself) — allow it, this is what the Harness team does for self-review

---

## Success Criteria

- [ ] User can initiate a review from the Review Panel with 2 clicks
- [ ] Review comments appear inline on the diff viewer within 30 seconds
- [ ] Auto-iterate mode completes a full review loop (author fix → re-review) without human intervention
- [ ] Cost tracking is accurate per-round
- [ ] Review state persists across app restart (via review_store)
