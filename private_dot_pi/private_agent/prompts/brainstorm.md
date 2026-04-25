---
description: Spawn N parallel subagents with diverse prompts to brainstorm ideas
argument-hint: "[N] <agent_type> <task>"
---
Use the subagent tool with PARALLEL mode to execute this brainstorming workflow:

## Parsing the Request

The user's input is: $@

From this, extract:
- **N**: Number of subagents (default: 3 if not explicitly specified)
- **agent_type**: The subagent type to use (default: "reviewer" if not specified)
- **task**: The core task or problem to solve
- **different_models**: Whether the user requested "with different models" or similar language

If the user's input is ambiguous about N or agent_type, use the defaults (3, "reviewer").

## Step 1: Model Selection (only if "different models" requested)

If the user explicitly asked for "different models" (or similar phrasing like "with different models", "across models", etc.):

1. Ask the user **N sequential questions**, one for each subagent, asking which model to use for that subagent.
2. Number them 1 through N.
3. Wait for the user's response to all N questions.
4. Once you have all N model selections, proceed to Step 2.

If the user did NOT ask for different models, skip this step and use the default model for the agent type.

## Step 2: Spawn Parallel Subagents

Spawn **N parallel subagents** using the specified `agent_type`. Each subagent should receive a **slightly different prompt** to encourage diverse perspectives and a wide range of ideas.

### Prompt Variation Strategy

Take the core task and reframe it for each subagent from a unique angle. For example:
- **Subagent 1**: Focus on the most obvious / conventional approach
- **Subagent 2**: Focus on an unconventional / creative approach
- **Subagent 3**: Focus on edge cases, constraints, or trade-offs
- **Subagent 4+**: Continue varying the angle (performance, security, simplicity, scalability, user experience, etc.)

Always include the core task in every prompt, but add a distinct lens or constraint.

### Subagent Configuration

```
{
  "action": "parallel",
  "tasks": [
    {
      "agent": "<agent_type>",
      "task": "<varied prompt 1>",
      <if different_models: "model": "<model_1>">
    },
    {
      "agent": "<agent_type>",
      "task": "<varied prompt 2>",
      <if different_models: "model": "<model_2>">
    },
    ...
  ],
  "concurrency": <N>
}
```

## Step 3: Synthesize Results

After all N subagents complete:
1. Collect all responses
2. Identify common themes and unique insights
3. Present a structured summary of all ideas, grouped by theme
4. Highlight the most novel or valuable ideas from each subagent
5. Note any contradictions or interesting trade-offs between approaches

Present the final synthesis to the user.
