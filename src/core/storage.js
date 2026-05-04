export function readString(key, fallback = '') {
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key, value) {
  try {
    if (value === '' || value === null || typeof value === 'undefined') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // no-op
  }
}

export function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}
