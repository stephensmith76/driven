# Rules data

Machine-readable rules. The sheets, the builder, the dice roller and the simulator all read these files (SPEC.md principle 2). They were generated from `../rules.md` on Nov 10. Since then, edit them by hand or by commit. When a rule changes, update `rules.md` and the matching entry here in the same commit, and bump `rules_version` in `core.json`. Campaigns then show a "Rules updated" notice.

| File | Holds |
| --- | --- |
| `core.json` | `rules_version`, defenses, Impact bands, Harm boxes, Stress stages, Drive, slots, clocks, case and Dawn rules, villain scaling |
| `archetypes.json` | The 5 archetypes |
| `traits.json` | The 8 Traits |
| `flairs.json` | The 9 Flairs (3 marked `trial`) |
| `gear.json` | Gear, including the trial "More gear" list |
| `kit.json` | The 7 Kit items |
| `powers.json` | Street and strange powers, flaws, villain-only powers |
| `villains.json` | Roles, the Butcher, Voss, a lieutenant template, the Saints |
| `tags.json` | Ranges and zone tags |

## Entry fields

Every entry has a stable `id` (never rename one: sheets store it), a `name`, and its `text`.

Fields the engine uses to work out numbers:

- `weapon`: `unarmed`, `light`, `heavy`, `pistol` or `knife`.
- `toughness`: a map from attack kind (`blunt`, `blade`, `gun`, `hazard`) to a value.
- `guard`: a bonus to Guard.
- `uses_per_fight`: how many times the item works per fight.
- Powers put these inside `effects: [{ "level": n, ... }]`. An effect applies once the hero has unlocked ability `n`.

`sim` tells the simulator what the entry does, using the allowed fields in SPEC.md "Rules data":

- `null`: it matters in a fight, but the simulator can't model it. It shows under "Not simulated".
- `{}`: it has no effect in a fight (Patrol or Dawn only), so there's nothing to model.

`npm test` fails if a gear, Kit, power, Flair, archetype or Trait name here is missing from `rules.md`.
