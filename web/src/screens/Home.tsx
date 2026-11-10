import { useState } from 'react'
import { go } from '../router'

export function Home() {
  const [code, setCode] = useState('')
  return (
    <main className="page">
      <h1>Street Level</h1>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) go(`/join/${code.trim().toUpperCase()}`)
        }}
      >
        <label htmlFor="code">Join a table</label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="Join code" autoCapitalize="characters" autoComplete="off" />
        <button type="submit" disabled={!code.trim()}>Join</button>
      </form>
      <p className="muted center"><a href="#/gm">I'm the GM</a></p>
    </main>
  )
}
