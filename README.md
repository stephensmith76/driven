# Driven - Street Level Heroic RPG: companion app

A table companion for Driven, the Street Level Heroic RPG. The spec is [SPEC.md](SPEC.md), and the rules are [rules/rules.md](rules/rules.md).

- Live site: https://stephensmith76.github.io/driven/
- Players: open the join link the GM shares (`#/join/<code>`).
- GM: open `#/gm`, then enter the campaign's join code and GM passcode, or create a campaign.

## Develop

```sh
npm install
npm run dev            # web app at http://localhost:5173
npm test               # engine and patch tests (Vitest)
npm run test:db        # all four checks below, against the real Supabase project
npm run test:access    # who can read and write what (stranger, player, GM)
npm run test:sync      # a change on one device reaches the others within 2 seconds
npm run test:roundtrip # export, patch import and undo round-trip
npm run test:secrets   # the case file never appears in a player's network traffic
```

The database tests create throwaway campaigns named "… (safe to delete)" and delete them when they finish.

Cases load on the Case file screen as JSON: see [supabase/seed/CASE_FORMAT.md](supabase/seed/CASE_FORMAT.md).

`web/.env` holds the Supabase URL and publishable key. Both are public by design. The service role key and the Gemini key never go in this repo.

## Database

Migrations live in `supabase/migrations/`. To apply them:

```sh
supabase link --project-ref hwxwvkbtxlvzyaxcswjb
supabase db push
```
