# SpiceHub PWA Constitution

**Project**: SpiceHub Meal & Recipe Planner  
**Goal**: Zero-cost downloadable PWA (Vercel + installable on Android/iOS/Windows) with strong device local storage, offline-first behavior, and functional Instagram/social media recipe import.

## Core Principles (Non-Negotiable)
Extraction Excellence: The Instagram/Social import is the product. It must utilize LLM-based parsing to transform messy captions into structured, high-fidelity recipe data (Schema.org compliant) with near-zero manual correction required.
Offline Sovereignty: The app must be fully functional without an internet connection. State must sync optimistically; all user actions are queued and persisted locally (IndexedDB/LocalStorage) before hitting the network.
Security-First Architecture: Zero tolerance for hardcoded secrets. Environment variables and secure headers are mandatory. API routes must be rate-limited and protected.

## Preferred Tools & Workflow
- Conventional Commit cmd provided for every change package. 
- CLAUDE ONLY PROVIDES THE GIT COMMIT CMDS, DO NOT ATTEMPT TO COMMIT TO GIT, User will manually make the commits to ensure they go to the right place

## High-Priority Focus Areas (Current Sprint)
1. Instagram Import
   - Significantly better text scraping and auto-sorting

2. UI/UX Polish
   - Smooth slide-down gestures on all modals
   - Larger, consistent touch targets
   - Clear progress feedback during imports
   - Inviting empty states and Week View polish


You are now operating under this constitution.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
