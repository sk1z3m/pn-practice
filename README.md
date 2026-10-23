# PN Practice

Practice tests and ranked quizzes for Practical Nursing students. Runs free on Cloudflare Workers + D1.

## What's here

- **Students** (`/`): pick a nickname, get a study code (no accounts or emails). Practice mode gives fresh random questions with instant rationales, weighted toward ones you've missed. Ranked tests are one attempt, same questions for everyone, scored on the server, with answers unlocking after the test closes.
- **Leaderboards**: per ranked test (score, then time), overall ranked points, and practice (different questions answered correctly in the last 7 days).
- **Admin** (`/admin`): import questions from Claude as drafts, review/edit/approve, build ranked tests with open/close times, see results, hide or rename players, remove duplicate attempts.

## Adding questions

1. Upload a lecture deck to Claude.ai with the prompt on the admin **Import** tab.
2. Paste the JSON reply into the Import box → **Check** → **Import as drafts**.
3. On **Questions**, read each draft against the slide in its *Source* line, fix anything off, and approve.

## Setup (one time)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → this repo. Deploy with the defaults.
2. Worker → Settings → Variables and Secrets → add a **Secret** named `ADMIN_KEY`. Its value is the admin password. Share it only with trusted admins.

The D1 database `pn-practice-db` is already created and bound in `wrangler.toml`. Schema is in `migrations/`. `seed/` holds the sample questions (not from course decks; retire them once real banks are in).

## Files

- `src/index.js`: API (all scoring happens here)
- `public/`: student site (`index.html`, `app.js`), admin (`admin.html`, `admin.js`), `styles.css`
