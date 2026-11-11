import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const repo = resolve(import.meta.dirname, '..')

// Publish rules/ and the simulator next to the page, so the page, the
// simulator worker and the rules-helper function all read the same versions.
function publishRulesAndSim(): Plugin {
  return {
    name: 'publish-rules-and-sim',
    apply: 'build',
    closeBundle() {
      const out = resolve(import.meta.dirname, 'dist')
      cpSync(resolve(repo, 'rules'), resolve(out, 'rules'), { recursive: true })
      mkdirSync(resolve(out, 'sim'), { recursive: true })
      cpSync(resolve(repo, 'sim/street_level_sim.py'), resolve(out, 'sim/street_level_sim.py'))
    },
  }
}

// In dev, serve the same simulator file at the same relative path the build publishes it to.
function serveSimInDev(): Plugin {
  return {
    name: 'serve-sim-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sim/street_level_sim.py', (_req, res) => {
        res.setHeader('Content-Type', 'text/x-python; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(resolve(repo, 'sim/street_level_sim.py')))
      })
    },
  }
}

export default defineConfig({
  // Relative base + hash routing: works at https://<user>.github.io/<repo>/
  base: './',
  plugins: [react(), publishRulesAndSim(), serveSimInDev()],
  // The simulator worker imports Pyodide at run time, so it must be an ES module worker.
  worker: { format: 'es' },
  server: { fs: { allow: [repo] } },
  test: { include: ['src/**/*.test.ts'] },
})
