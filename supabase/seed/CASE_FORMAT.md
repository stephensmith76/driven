# Case file format

The Case file screen stores the hidden case in `gm_secrets.case` and the arc sheet in `gm_secrets.arc`. To load a case, paste JSON in this shape into the Case file screen ("Edit as JSON"). You can also send it as a patch: `{"table": "gm_secrets", "set": {"case": {...}}}`.

Only the GM's device ever reads these. Players see a clue only after the GM presses **Reveal**, which copies just that clue's text into the found-clues list.

```json
{
  "title": "The Butcher of Fifth Street",
  "mode": "fixed",
  "complexity": 6,
  "culprit": "Who is really behind it",
  "facets": { "who": "…", "what": "…", "where": "…" },
  "cast": [
    { "name": "D. Marsh", "who": "property developer", "motive": "…", "hides": "…" }
  ],
  "leads": [
    { "name": "Kenny Lam's pawnshop", "rating": 1, "approach": "lean on him", "text": "what's there" }
  ],
  "clues": [
    { "id": "k1", "text": "Ledger: six gas cans sold to Saints", "lead": "Kenny Lam's pawnshop",
      "points_to": ["Saints", "Marsh"] },
    { "id": "k2", "text": "Nightjar's plate on the van", "personal_for": "Nightjar" },
    { "id": "a1", "text": "Harbor & Main Holdings eviction notice", "is_arc": true }
  ],
  "scheme_steps": ["What happens at tick 1", "…", "Tick 6: the villain pulls it off"],
  "confrontation": "Where and how the showdown happens"
}
```

| Field | Notes |
| --- | --- |
| `mode` | `fixed` (the GM picked the culprit) or `floating` (the theory decides) |
| `complexity` | 4 for a one-Night job. A normal case is 2 plus twice the number of heroes (6 for two, 8 for three, 10 for four). An arc finale is 2 more. Crack the Case rolls against 10 + Complexity |
| `leads[].rating` | Obstacle rating. The defense is 12 + rating |
| `clues[].id` | Required and unique within the case: the Reveal button uses it |
| `clues[].personal_for` | A hero's name. It counts as 2 clues in a theory, and revealing it offers to tick that hero's Home clock |
| `clues[].is_arc` | Points past this case to the Mastermind. It doesn't count toward this case's theory |
| `opening`, `hostage` | Optional text: how Night 1 opens; who is held, when, and where |
| `scenes` | Optional prepared scenes: `id`, `title`, `text` (players see it once set up), `zones` (`id`, `name`, `tags` as tag ids from `tags.json`, `links`), `obstacles` (`name`, `rating`), `extras` (`name`, `zone`), `enemies` (rows for the `enemies` table). The Case file's **Set up on the Fight screen** button copies one to the scene and replaces the enemies |
| `clues[].revealed` | Set by the app. Leave it out |
| `crack_log` | Written by the Night screen. Leave it out |

Arc sheet (`gm_secrets.arc`):

```json
{
  "mastermind": "Augustine Voss",
  "endgame": "Empty the neighborhood, burn what's left, rebuild it as his",
  "tools": [{ "name": "The Butcher", "knows": "who pays him" }],
  "calling_card": "Eviction notices from Harbor & Main Holdings",
  "arc_clues": []
}
```

The Endgame clock (8 segments) is an ordinary hidden clock with `kind: "endgame"`. The Case file screen can add it.

## The demo case

`butcher_case.json` (Stephen's seed, format `street-level-seed/1`) is the source for the demo campaign: heroes, clocks, both scenes, enemies, case and arc clues. `web/src/data/demoSeed.ts` converts it into the shapes above; it is never edited by hand into a second copy. "Create campaign" with Demo checked loads all of it, and an empty Case file has a **Load the Butcher case** button for campaigns that already exist. `npm run test:demo` checks it against the real project.
