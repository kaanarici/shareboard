export const LOCKED_SHARE_PIN_LENGTH = 6;

export function cleanPin(value: string) {
  return value.replace(/\D/g, "").slice(0, LOCKED_SHARE_PIN_LENGTH);
}

export function isCompletePin(value: string) {
  return cleanPin(value).length === LOCKED_SHARE_PIN_LENGTH;
}
