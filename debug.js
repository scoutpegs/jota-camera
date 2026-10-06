// Test mode: lets the organiser pretend things are broken. Hidden: open Settings and tap the version 7 times.
const KEY = 'jota.debug';
const defaults = { offline: false, failUploads: false, storageFull: false, slow: false, serverDown: false, noGps: false, noCamera: false, noMic: false };
let state = { ...defaults };
try { state = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ignore */ }

export const debug = {
  get: (k) => !!state[k],
  set(k, v) { state[k] = !!v; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } window.dispatchEvent(new Event('jota-debug')); },
  all: () => ({ ...state }),
  any: () => Object.values(state).some(Boolean),
  reset() { state = { ...defaults }; try { localStorage.removeItem(KEY); } catch { /* ignore */ } window.dispatchEvent(new Event('jota-debug')); },
};
