# Driven: a Street Level RPG companion app

A table companion for the Street Level RPG. The spec is [SPEC.md](SPEC.md), and the rules are [rules/rules.md](rules/rules.md).

- Live site: https://stephensmith76.github.io/driven/
- Players: open the join link the GM shares (`#/join/<code>`).
- GM: open `#/gm`, then enter the campaign's join code and GM passcode, or create a campaign.

## Develop

```sh
npm install
npm run dev            # web app at http://localhost:5173
npm test               # engine tests (Vitest)
npm run test:access    # access-rule check against the real Supabase project
```

`web/.env` holds the Supabase URL and publishable key. Both are public by design. The service role key and the Gemini key never go in this repo.

## Database

Migrations live in `supabase/migrations/`. To apply them:

```sh
supabase link --project-ref hwxwvkbtxlvzyaxcswjb
supabase db push
```
