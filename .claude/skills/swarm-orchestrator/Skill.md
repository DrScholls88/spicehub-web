# Swarm Orchestrator (RUFLo)

Coordinate specialized agent swarms to execute complex workflows while minimizing token overhead via scoped context injection.

## Core Logic (RUFLo)
1. **READ**: Analyze the current task and identify which specialized skills from `.claude/skills/` are required.
2. **UPDATE**: Create or update `.claude/swarm_state.json` with the minimal code snippets and context needed for the next step.
3. **FEEDBACK**: Trigger the specialized skill. If the output requires refinement, loop back to the relevant specialist.

## Commands
- `/swarm [goal]`: Initiates a coordinated swarm effort.
- `/swarm-status`: Reads `swarm_state.json` to report the current stage and pending tasks.

## Workflow Patterns

### 1. Frontend Hardening (Design + UX)
- **Sequence**: `/audit` -> `/impeccable` -> `/polish` -> `/full-output-enforcement`
- **Focus**: Validates the "Craft" of new UI components like `MealLibrary` and `AddEditMeal`.

### 2. Logic & Pipeline Audit
- **Sequence**: `/audit` -> `/debug-issue` -> `/refactor-safely`
- **Focus**: Hardens the `recipeParser` and `import pipeline` logic.

## Operational Rules
- **Token Saver**: Never pass the entire codebase to a worker agent. Pass only the relevant file or function found in `swarm_state.json`.
- **Context Forking**: Use `context fork` when transitioning between skills to maintain the chain without re-explaining the goal.
- **Aggregator**: When a swarm finishes, the orchestrator must synthesize all results into a final `review-changes` report.

## Memory Structure (.claude/swarm_state.json)
{
  "project": "spicehub-web",
  "active_swarm": "string",
  "stage": "research | audit | implementation | polish",
  "context_snippets": [],
  "pending_feedback": [],
  "completed_tasks": []
}