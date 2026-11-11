import { useState } from 'react'
import { errorText, supabase } from '../../data/supabase'
import { go } from '../../router'
import { RULES_VERSION } from '../../engine'
import demoHeroes from '../../../../supabase/seed/demo-heroes.json'

export function CreateCampaign() {
  const [name, setName] = useState('')
  const [passcode, setPasscode] = useState('')
  const [demo, setDemo] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc('create_campaign', { p_name: name, p_passcode: passcode, p_rules_version: RULES_VERSION })
      if (error) throw error
      const row = (data as { campaign_id: string; join_code: string }[])[0]
      if (demo) {
        const { error: e2 } = await supabase.from('characters')
          .insert(demoHeroes.map((h) => ({ ...h, campaign_id: row.campaign_id })))
        if (e2) throw e2
      }
      go(`/gm/${row.campaign_id}`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1>New campaign</h1>
      <form className="card stack" onSubmit={submit}>
        <label htmlFor="n">Name</label>
        <input id="n" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <label htmlFor="p">GM passcode <span className="muted small">(4+ characters; you'll need it on other devices)</span></label>
        <input id="p" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          Add the five sample heroes
        </label>
        <button type="submit" disabled={busy || !name.trim() || passcode.length < 4}>Create</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  )
}
