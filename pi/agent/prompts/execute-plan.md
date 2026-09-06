Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "planner" agent to break down the following task into small, actionable, and reviewable steps:

  Task: $@

  Requirements:
  - Break the task into discrete steps that can be completed independently
  - Each step should be small enough to be reviewed quickly
  - Order steps logically (dependencies first)
  - Output a numbered list of steps

2. Then, for EACH step from the plan above, execute a worker-reviewer loop:

  **Step [N]: [Step Description]**

  a. Use the "worker" agent to implement this step:
     - Focus ONLY on this specific step
     - Reference previous steps' output via {previous} if needed
     - Document what was done

  b. Use the "reviewer" agent to review the implementation:
     - Check if the step is fully complete
     - Identify any issues, missing pieces, or improvements
     - Provide specific, actionable feedback
     - Clearly state "APPROVED" or list required changes

  c. If reviewer did NOT approve, use the "worker" agent again to:
     - Address all feedback from the reviewer
     - Re-submit for review (go back to step b)

  d. Continue the worker-reviewer loop until the reviewer approves the step

3. After ALL steps are approved, use the "worker" agent for final integration:
  - Ensure all steps work together
  - Clean up any temporary code or artifacts
  - Provide a summary of what was accomplished

Execute this as a chain, passing output between steps via {previous}. Each worker-reviewer loop should use {previous} to pass context between iterations.

!IMPORTANT: DO NOT CHAIN SUBAGENTS - Execute them yourself!
