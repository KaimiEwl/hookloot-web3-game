export function emitWindowEvent(eventName, detail) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function subscribeWindowEvent(eventName, listener) {
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
