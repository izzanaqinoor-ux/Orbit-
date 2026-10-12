# Going live (free tiers, checked October 2026)

Three services, one job each:

| Part | Host | Free-tier facts to know |
|---|---|---|
| Database | Neon | 1 GB per project, no card needed, sleeps after 5 min idle and wakes on the next query |
| API | Render (Web Service) | Sleeps after 15 min without traffic; first request after that takes about a minute |
| Website | Netlify | 300 credits a month; a production deploy costs 15, bandwidth 20 per GB. Sites pause if credits run out |

Do not use Render's own free Postgres: it is deleted 30 days after creation.

## 0. Put the code on GitHub
1. Create an empty repository on github.com named `orbit` (private is fine).
2. In the unzipped `orbit` folder:
   ```
   git init
   git add .
   git commit -m "Orbit v1"
   git branch -M main
   git remote add origin https://github.com/<your-username>/orbit.git
   git push -u origin main
   ```
3. Check that `.env` files are NOT in the repository.

## 1. Database (Neon)
1. Sign up at neon.com. Create a project named `orbit`, Postgres version 17 (15 or newer is required).
2. On the project dashboard click **Connect**. Turn **Connection pooling OFF**.
3. Copy the connection string. It looks like `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`. Keep it for step 2.

## 2. API (Render)
1. Sign up at render.com with GitHub. **New + > Web Service**, pick the `orbit` repository.
2. Settings:
   - Root Directory: `backend`
   - Runtime: Python 3
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Instance Type: Free
3. Environment variables:
   - `DATABASE_URL` = the Neon string from step 1
   - `SECRET_KEY` = output of `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`
   - `ENVIRONMENT` = `production`
   - `PYTHON_VERSION` = `3.11.9`
   - `CORS_ORIGINS` = `http://localhost:5173` for now (changed in step 4)
   - `ALLOW_SIGNUPS` = `true` for now. After you have made your own account (step 4), set it to `false` so nobody else can register
4. Create the service. Wait for "Live". Open `https://<your-service>.onrender.com/health/db`: it should show `"public_tables": 11`.
5. Copy the service URL (no trailing slash).

## 3. Website (Netlify)
1. Sign up at netlify.com with GitHub. **Add new site > Import an existing project**, pick `orbit`.
2. Settings: Base directory `frontend`, Build command `npm run build`, Publish directory `frontend/dist` (Netlify reads `frontend/netlify.toml`; if it fills these in already, leave them).
3. **Add environment variable**: `VITE_API_URL` = the Render URL from step 2.5.
4. Deploy. Copy the site URL, for example `https://orbit-yourname.netlify.app`. You can rename it under Site configuration > Change site name.

## 4. Connect them
1. Render > your service > Environment: set `CORS_ORIGINS` to the Netlify URL (no trailing slash). Save. Render redeploys.
2. Open the Netlify URL, create your account, and add a commitment.
3. Render > Environment: set `ALLOW_SIGNUPS` to `false`. Only your account can sign in from now on. Your data is in Neon, so every device you sign in on sees the same Orbit.

## If something is wrong
- Sign-in spins or fails right after a quiet period: the API is waking up. Wait a minute and retry.
- Browser console says "CORS": `CORS_ORIGINS` does not exactly match the Netlify URL.
- Page loads but calls go to 127.0.0.1: `VITE_API_URL` was set after the build. Netlify > Deploys > Trigger deploy > Clear cache and deploy.
- Render deploy fails on `alembic`: the Neon string is wrong or pooling was left on.

## Updating later
Push to `main`. Both Render and Netlify redeploy automatically.
