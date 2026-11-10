import { useEffect, useState } from 'react'

/** Hash routing, so the static site works on GitHub Pages without rewrites. */
export function useHashPath(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return path
}

export function go(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}

export function joinLink(joinCode: string): string {
  const base = window.location.href.split('#')[0]
  return `${base}#/join/${joinCode}`
}
