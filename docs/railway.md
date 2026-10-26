# Deploying SouqCue on Railway

1. **New project → Deploy from GitHub repo** → pick this repo and the branch you want live (`dev`). Railway finds `railway.toml` and builds the `Dockerfile`.
2. **Add a Volume** to the service and mount it at `/app/data` (10 GB is plenty). Without it, every redeploy wipes recordings and accounts.
3. **Variables** (service → Variables):

   | Variable | Value |
   | --- | --- |
   | `OPENAI_API_KEY` | your key (paste it here; never commit it) |
   | `AUTH_SECRET` | `${{ secret(48) }}` (Railway makes a random value once and keeps it) |
   | `AUTH_DIR` | `/app/data/auth` |
   | `HINGLISH_WORDS_FILE` | `/app/data/hinglish_words.json` |
   | `WEB_CONCURRENCY` | `1` |
   | `DEMO_LOGIN` | `false` for real data (`true` only for a demo) |
   | `AUTH_ALLOW_SIGNUP` | `true` until you have made your own account, then `false` |

   `PORT` is set by Railway. `STORAGE_BACKEND=local` and `QUEUE_BACKEND=inline` are the defaults.
4. **Networking → Generate Domain**, open it, and create the first account (it becomes the admin).
5. **OpenAI billing:** set a monthly spending limit in the OpenAI console.

The first start copies the 12 sample recordings into an empty volume.
