import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { go } from '../../router'

export function GmEnter() {
  const [campaign, setCampaign] = useState('')
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('claim_gm', { p_campaign: campaign, p_passcode: passcode })
    setBusy(false)
    if (error) setError(error.message)
    else go(`/gm/${data as string}`)
  }

  return (
    <main className="page">
      <h1>GM</h1>
      <form className="card stack" onSubmit={submit}>
        <label htmlFor="c">Campaign join code</label>
        <input id="c" value={campaign} onChange={(e) => setCampaign(e.target.value)}
          autoCapitalize="characters" autoComplete="off" />
        <label htmlFor="p">GM passcode</label>
        <input id="p" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        <button type="submit" disabled={busy || !campaign || !passcode}>Open as GM</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p className="center"><a href="#/gm/new">Create a new campaign</a></p>
    </main>
  )
}
