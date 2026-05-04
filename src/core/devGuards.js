export function shouldExposeDebugEconomyGlobals(env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined)) {
  return !!env?.DEV;
}
