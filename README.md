# Auto Mode Policy

## What This Plugin Does

This plugin provides a policy query tool for AGH Harness's auto-execution mode. It advises the model on tool execution permissions, risk classification, and approval requirements before sensitive operations are performed.

### Tool: `agh_auto_mode_policy`

Queries the auto-mode permission policy and returns:
- The active sandbox preset (danger-full-access, workspace-write, or read-only)
- Approval behavior for the preset
- When a `toolName` is provided: a risk assessment (low/medium/high) with approval guidance for that specific tool

**When to use:** Call this tool before executing potentially sensitive operations to determine whether approval is needed and what sandbox constraints apply.

## Installation

```bash
agh package add @agh-hub/auto-mode
```

## Credential Configuration

No credentials required. This plugin operates entirely locally with no external network access.

## Differences from Original Plugin

The original upstream package was a **host hook plugin** that intercepted tool execution at runtime via event subscriptions (`tools/pre-execute`, `tools/post-execute`, `approval/request`, `tools/result`) and dynamically injected approval policies using an LLM-based classifier (an LLM-based classifier).

### Degradations in AGH Harness:

1. **Runtime interception → Explicit query (high severity):** The original plugin automatically intercepted every tool execution. AGH has no event bus or tool interception mechanism, so this is degraded to an explicit query tool that the model must call proactively.

2. **LLM classifier → Static rules (medium severity):** The original plugin used an LLM to classify tool risk dynamically. AGH has no LLM service available, so risk classification uses static pattern matching on tool names and metadata.

3. **Browser UI layer removed (medium severity):** The original plugin included a browser compatibility layer with icon injection, localized labels, and a risk acknowledgement dialog. AGH has no UI rendering capability, so this is not converted.

4. **Session-scoped state → Stateless (low severity):** The original plugin used session-scoped dependency injection to track auto-mode state across interactions. The AGH version is stateless; each query returns the policy independently.