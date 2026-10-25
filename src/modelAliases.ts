export const PLACEHOLDER_MODEL_MAP: Record<string, string> = {
  // Gemini 3.8 / 3.1 / 3
  MODEL_PLACEHOLDER_M318: 'gemini-3.8-flash',
  MODEL_PLACEHOLDER_M37: 'gemini-3.1-pro',
  MODEL_PLACEHOLDER_M36: 'gemini-3.1-pro-low',
  MODEL_PLACEHOLDER_M18: 'gemini-3-flash',
  MODEL_PLACEHOLDER_M8: 'gemini-3-pro',
  MODEL_PLACEHOLDER_M7: 'gemini-3-pro-low',
  MODEL_PLACEHOLDER_M9: 'gemini-3-pro-image',

  // Claude models
  MODEL_PLACEHOLDER_M26: 'claude-opus-4-6-thinking',
  MODEL_PLACEHOLDER_M35: 'claude-sonnet-4-6-thinking',
  MODEL_PLACEHOLDER_M12: 'claude-opus-4-5-thinking',
  MODEL_CLAUDE_4_5_SONNET: 'claude-sonnet-4-5',
  MODEL_CLAUDE_4_5_SONNET_THINKING: 'claude-sonnet-4-5-thinking',

  // OpenAI models
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'gpt-oss-120b-medium',
};

export const MODEL_HUMAN_NAMES: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.8-flash-n': 'Gemini 3.8 Flash',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
  'claude-sonnet-4-6-thinking': 'Claude 4.6 Sonnet (Thinking)',
  'claude-opus-4-6-thinking': 'Claude 4.6 Opus (Thinking)',
  'claude-sonnet-4-5': 'Claude 3.7 / 4.5 Sonnet',
  'claude-sonnet-4-5-thinking': 'Claude 3.7 / 4.5 Sonnet (Thinking)',
  'claude-opus-4-5-thinking': 'Claude 4.5 Opus (Thinking)',
  'gpt-oss-120b-medium': 'GPT OSS 120B',
};

export function resolveModelName(rawModel?: string, modelDisplayName?: string): { model: string; displayName: string } {
  if (modelDisplayName && modelDisplayName.trim()) {
    const cleanDisplay = modelDisplayName.trim();
    const cleanModel = rawModel ? (PLACEHOLDER_MODEL_MAP[rawModel] ?? rawModel) : cleanDisplay.toLowerCase().replace(/\s+/g, '-');
    return { model: cleanModel, displayName: cleanDisplay };
  }

  if (!rawModel) {
    return { model: 'unknown', displayName: 'Default Model' };
  }

  const mapped = PLACEHOLDER_MODEL_MAP[rawModel] ?? rawModel;
  const human = MODEL_HUMAN_NAMES[mapped] || formatFallbackName(mapped);
  return { model: mapped, displayName: human };
}

function formatFallbackName(model: string): string {
  return model
    .replace(/^MODEL_PLACEHOLDER_/, 'Gemini Model ')
    .replace(/^gemini-/, 'Gemini ')
    .replace(/^claude-/, 'Claude ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
