/** Is a text field, a dialog or the keypad taking the keyboard right now? */
export function keyboardBusy(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return true;
  return !!document.querySelector('.numpad-backdrop, .bb-scrim, .ie-card');
}
