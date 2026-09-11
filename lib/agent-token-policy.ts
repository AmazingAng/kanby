export const MAX_AGENT_TOKEN_NAME_LENGTH = 48;

export function normalizeAgentTokenName(value: unknown) {
  if (typeof value !== 'string') return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return null;
  }
  const name = value.trim();
  if (!name || name.length > MAX_AGENT_TOKEN_NAME_LENGTH) return null;
  return name;
}

export function agentTokenLabel(userLogin: string, tokenName: string) {
  return `${userLogin}_${tokenName}`;
}
