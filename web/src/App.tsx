import { useEffect, useState } from 'react'
import { configured, ensureSignedIn, errorText } from './data/supabase'
import { useHashPath } from './router'
import { Home } from './screens/Home'
import { Join } from './screens/player/Join'
import { Sheet } from './screens/player/Sheet'
import { BankHeroBuilder, Builder } from './screens/player/Builder'
import { Rolls } from './screens/player/Rolls'
import { GmEnter } from './screens/gm/GmEnter'
import { GmTable } from './screens/gm/GmTable'
import { CreateCampaign } from './screens/gm/CreateCampaign'
import { Night } from './screens/gm/Night'
import { CaseFile } from './screens/gm/CaseFile'
import { Admin } from './screens/gm/Admin'
import { Fight } from './screens/gm/Fight'
import { EncounterLab } from './screens/gm/EncounterLab'
import { Bank } from './screens/gm/Bank'
import { Villains } from './screens/gm/Villains'
import { VillainBuilder } from './screens/gm/VillainBuilder'
import { Display } from './screens/Display'
import { Errata } from './screens/Errata'
import { ConnectionBadge } from './components/ConnectionBadge'

export default function App() {
  return (
    <>
      <Routes />
      <footer className="site-links small muted">
        <a href="./rules/rules.md" target="_blank" rel="noreferrer">Rules</a> ·{' '}
        <a href={`./rules/${encodeURIComponent('Driven - Street Level Heroic RPG.pdf')}`} target="_blank" rel="noreferrer">Rules (PDF)</a> ·{' '}
        <a href="#/errata">Errata</a>
      </footer>
      <ConnectionBadge />
    </>
  )
}

function Routes() {
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
  if (a === 'errata') return <Errata />
  if (a === 'join' && b) return <Join code={b} />
  if (a === 'c' && b && c === 'sheet') return <Sheet campaignId={b} characterId={d} />
  if (a === 'c' && b && c === 'display') return <Display campaignId={b} />
  if (a === 'c' && b && c === 'rolls') return <Rolls campaignId={b} characterId={d} stat={e} />
  if (a === 'c' && b && c === 'build') return <Builder campaignId={b} characterId={d} />
  if (a === 'gm' && b === 'new') return <CreateCampaign />
  if (a === 'gm' && b && c === 'night') return <Night campaignId={b} />
  if (a === 'gm' && b && c === 'fight') return <Fight campaignId={b} />
  if (a === 'gm' && b && c === 'lab') return <EncounterLab campaignId={b} />
  if (a === 'gm' && b && c === 'case') return <CaseFile campaignId={b} />
  if (a === 'gm' && b && c === 'bank' && d === 'hero') return <BankHeroBuilder campaignId={b} entryId={e} />
  if (a === 'gm' && b && c === 'bank' && d === 'villain') return <VillainBuilder campaignId={b} id={e} bank />
  if (a === 'gm' && b && c === 'bank') return <Bank campaignId={b} />
  if (a === 'gm' && b && c === 'villains' && d) return <VillainBuilder campaignId={b} id={d} />
  if (a === 'gm' && b && c === 'villains') return <Villains campaignId={b} />
  if (a === 'gm' && b && c === 'admin') return <Admin campaignId={b} />
  if (a === 'gm' && b) return <GmTable campaignId={b} />
  if (a === 'gm') return <GmEnter />
  return <Home />
}
