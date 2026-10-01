export function recoverySnapshot(): string | null {
  return process.env.KANBY_RECOVERY_SNAPSHOT?.trim() || null;
}
