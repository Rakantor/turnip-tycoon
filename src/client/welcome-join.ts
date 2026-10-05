/** An invite answered in the welcome dialog is joined once the new profile exists. */
let pending: string | null = null;

const normalized = (code: string) => code.replace(/[^a-z0-9]/gi, '').toUpperCase();

export function rememberWelcomeJoin(code: string) {
  pending = code;
}
export function isWelcomeJoin(code: string): boolean {
  return pending !== null && normalized(pending) === normalized(code);
}
export function clearWelcomeJoin() {
  pending = null;
}
