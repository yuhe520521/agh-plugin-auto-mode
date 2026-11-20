const Kind = Symbol.for('TypeBox.Kind')
const Optional = Symbol.for('TypeBox.Optional')
const optional = (s) => ({ ...s, [Optional]: 'Optional' })
const str = (o = {}) => ({ [Kind]: 'String', type: 'string', ...o })
const num = (o = {}) => ({ [Kind]: 'Number', type: 'number', ...o })
const int = (o = {}) => ({ [Kind]: 'Integer', type: 'integer', ...o })
const bool = (o = {}) => ({ [Kind]: 'Boolean', type: 'boolean', ...o })
const enumOf = (...v) => ({ [Kind]: 'Union', anyOf: v.map((x) => ({ [Kind]: 'Literal', type: 'string', const: x })) })
const arr = (items, o = {}) => ({ [Kind]: 'Array', type: 'array', items, ...o })
const obj = (properties = {}, required = []) => ({ [Kind]: 'Object', type: 'object', additionalProperties: false, required, properties })
const rec = (o = {}) => {
  const { additionalProperties: _ap, ...rest } = o
  return { [Kind]: 'Object', type: 'object', ...rest, properties: rest.properties || {} }
}

function textResult(value) {
  const text = typeof value === 'string'
    ? value
    : (value === undefined || value === null ? '' : JSON.stringify(value, null, 2))
  return { content: [{ type: 'text', text }] }
}

// --- Permission preset definitions (from original cordis.patch.yml) ---
const PRESETS = {
  'danger-full-access': {
    sandbox: 'danger-full-access',
    approval: 'never',
    description: 'Workspace-sandboxed execution with automatic review and one-shot approval for wider access.',
    riskLevel: 'high',
    allows: ['full filesystem access', 'network access', 'command execution'],
    requiresApproval: false
  },
  'workspace-write': {
    sandbox: 'workspace-write',
    approval: 'always',
    description: 'Execution restricted to workspace directory with per-action approval.',
    riskLevel: 'medium',
    allows: ['workspace file read/write', 'limited command execution'],
    requiresApproval: true
  },
  'read-only': {
    sandbox: 'read-only',
    approval: 'always',
    description: 'Read-only access with no side effects permitted.',
    riskLevel: 'low',
    allows: ['file read', 'search', 'query'],
    requiresApproval: false
  }
}

// --- Static risk classifier (degraded from the original LLM-based classifier) ---
const HIGH_RISK_PATTERNS = ['delete', 'remove', 'destroy', 'purge', 'wipe', 'reset', 'format', 'drop']
const MEDIUM_RISK_PATTERNS = ['write', 'create', 'update', 'modify', 'set', 'save', 'import', 'upload', 'send', 'apply', 'install', 'execute', 'run', 'deploy']
const READ_ONLY_PATTERNS = ['read', 'list', 'get', 'search', 'query', 'status', 'inspect', 'check', 'view', 'show', 'statistics']

function classifyRisk(toolName, toolMeta) {
  if (toolMeta && toolMeta.isDestructive === true) return 'high'
  if (toolMeta && toolMeta.isReadOnly === true) return 'low'
  const lower = (toolName || '').toLowerCase()
  if (HIGH_RISK_PATTERNS.some(p => lower.includes(p))) return 'high'
  if (READ_ONLY_PATTERNS.some(p => lower.includes(p))) return 'low'
  if (MEDIUM_RISK_PATTERNS.some(p => lower.includes(p))) return 'medium'
  return 'medium'
}

function getPolicyForPreset(presetName) {
  return PRESETS[presetName] || null
}

function getApprovalGuidance(riskLevel, preset) {
  if (preset && preset.approval === 'never') {
    return 'No approval required under current preset (auto-review enabled).'
  }
  if (riskLevel === 'high') {
    return 'High-risk operation: requires explicit user approval before execution. Destructive operations should be treated with maximum caution.'
  }
  if (riskLevel === 'medium') {
    return 'Medium-risk operation: requires user confirmation before execution.'
  }
  return 'Low-risk read-only operation: may proceed without explicit approval under auto mode.'
}

function buildPolicyResponse(args) {
  const presetName = args.preset || 'danger-full-access'
  const preset = getPolicyForPreset(presetName)
  if (!preset) {
    throw new Error(`Unknown permission preset: ${presetName}. Available presets: ${Object.keys(PRESETS).join(', ')}`)
  }
  const toolName = args.toolName || null
  const toolMeta = args.toolMeta || null
  const riskLevel = toolName ? classifyRisk(toolName, toolMeta) : null
  const approvalGuidance = riskLevel ? getApprovalGuidance(riskLevel, preset) : null
  const response = {
    mode: 'auto',
    preset: {
      name: presetName,
      sandbox: preset.sandbox,
      approval: preset.approval,
      description: preset.description,
      riskLevel: preset.riskLevel,
      allows: preset.allows,
      requiresApproval: preset.requiresApproval
    },
    systemPromptNote: 'Auto mode is active. Tool execution follows sandboxed auto-review policy. Operations that exceed the sandbox boundary require one-shot approval.',
    ...(toolName && {
      toolRiskAssessment: {
        toolName,
        riskLevel,
        approvalRequired: riskLevel === 'high' || (riskLevel === 'medium' && preset.requiresApproval),
        guidance: approvalGuidance
      }
    })
  }
  return response
}

export const autoMode = {
  inject: ['tools'],
  apply(ctx) {
    ctx.tools.register({
      name: 'agh_auto_mode_policy',
      description: 'Query the auto-mode permission policy and risk classification for tool execution. Returns the active sandbox preset (danger-full-access, workspace-write, or read-only), its approval behavior, and — when a toolName is provided — a risk assessment (low/medium/high) with approval guidance for that specific tool. Call this before executing potentially sensitive operations to determine whether approval is needed.',
      parameters: obj({
        preset: str({ description: 'Permission preset name to query. One of: "danger-full-access", "workspace-write", "read-only". Defaults to "danger-full-access".', enum: ['danger-full-access', 'workspace-write', 'read-only'] }),
        toolName: str({ description: 'Name of the tool to assess for risk and approval requirements. Optional; when omitted, only the preset policy is returned.' }),
        toolMeta: rec({
          description: 'Tool metadata if known (e.g. isReadOnly, isDestructive). Used to refine risk classification.',
          properties: {
            isReadOnly: bool({ description: 'Whether the tool is read-only.' }),
            isDestructive: bool({ description: 'Whether the tool is destructive.' })
          }
        })
      }, []),
      meta: {
        isReadOnly: true,
        isDestructive: false,
        isConcurrencySafe: true,
        isOpenWorld: false,
        replay: 'safe',
        costHint: {},
        deferLoading: true,
        discoveryGroup: 'policy',
        requiresApproval: 'never'
      },
      async execute(args, context) {
        const result = buildPolicyResponse(args || {})
        return textResult(result)
      }
    })
  }
}