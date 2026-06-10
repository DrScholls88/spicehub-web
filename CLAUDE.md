# SpiceHub PWA Constitution

**Project**: SpiceHub Meal & Recipe Planner  
**Goal**: Zero-cost downloadable PWA (Vercel + installable on Android/iOS/Windows) with strong device local storage, offline-first behavior, and functional Instagram/social media recipe import.

## Core Principles (Non-Negotiable)
Extraction Excellence: The Instagram/Social import is the product. It must utilize LLM-based parsing to transform messy captions into structured, high-fidelity recipe data (Schema.org compliant) with near-zero manual correction required.
Offline Sovereignty: The app must be fully functional without an internet connection. State must sync optimistically; all user actions are queued and persisted locally (IndexedDB/LocalStorage) before hitting the network.
Security-First Architecture: Zero tolerance for hardcoded secrets. Environment variables and secure headers are mandatory. API routes must be rate-limited and protected.

Full Output Enforcement on modified files. Do not leave modified files truncated or with build breaking Syntax errors. Nun npm run build and ensure no errors before closing to git cmds.

## Preferred Tools & Workflow
- This is a Windows PC not Linux, use only Windows based terminal commands to lookup.
- Conventional Commit cmd provided for every change package. 
- CLAUDE ONLY PROVIDES THE GIT COMMIT CMDS, DO NOT ATTEMPT TO COMMIT TO GIT, User will manually make the commits to ensure they go to the right place

## High-Priority Focus Areas (Current Sprint)
1. Instagram Import
   - Significantly better text scraping and auto-sorting

You are now operating under this constitution.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
