import { useEffect, useState } from 'react'
import { configured, ensureSignedIn, errorText } from './data/supabase'
import { useHashPath } from './router'
import { Home } from './screens/Home'
import { Join } from './screens/player/Join'
import { Sheet } from './screens/player/Sheet'
import { Builder } from './screens/player/Builder'
import { Rolls } from './screens/player/Rolls'
import { GmEnter } from './screens/gm/GmEnter'
import { GmTable } from './screens/gm/GmTable'
import { CreateCampaign } from './screens/gm/CreateCampaign'
import { Night } from './screens/gm/Night'
import { CaseFile } from './screens/gm/CaseFile'
import { Admin } from './screens/gm/Admin'
import { Fight } from './screens/gm/Fight'
import { EncounterLab } from './screens/gm/EncounterLab'

export default function App() {
  const path = useHashPath()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) return
    ensureSignedIn().then(() => setReady(true), (e) => setError(errorText(e)))
  }, [])

  if (!configured) {
    return <main className="page"><p className="error">
      Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY in web/.env.
    </p></main>
  }
  if (error) return <main className="page"><p className="error">Couldn't sign in: {error}</p></main>
  if (!ready) return <main className="page"><p className="muted">Connecting…</p></main>

  const [a, b, c, d, e] = path
  if (a === 'join' && b) return <Join code={b} />
  if (a === 'c' && b && c === 'sheet') return <Sheet campaignId={b} characterId={d} />
  if (a === 'c' && b && c === 'rolls') return <Rolls campaignId={b} characterId={d} stat={e} />
  if (a === 'c' && b && c === 'build') return <Builder campaignId={b} characterId={d} />
  if (a === 'gm' && b === 'new') return <CreateCampaign />
  if (a === 'gm' && b && c === 'night') return <Night campaignId={b} />
  if (a === 'gm' && b && c === 'fight') return <Fight campaignId={b} />
  if (a === 'gm' && b && c === 'lab') return <EncounterLab campaignId={b} />
  if (a === 'gm' && b && c === 'case') return <CaseFile campaignId={b} />
  if (a === 'gm' && b && c === 'admin') return <Admin campaignId={b} />
  if (a === 'gm' && b) return <GmTable campaignId={b} />
  if (a === 'gm') return <GmEnter />
  return <Home />
}
