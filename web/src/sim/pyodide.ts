// One pinned Pyodide build for the worker and the Node check (scripts/sim-check.ts).
// Pyodide 314.x runs Python 3.14, the same as the command line on Stephen's machine.
export const PYODIDE_VERSION = '314.0.7'
export const PYODIDE_URL = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`
