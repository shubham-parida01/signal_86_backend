## Deploying Signal 86 Backend to Render

This folder contains the configuration you can use to deploy the existing backend to Render as a Node web service.

### 1. Repo contents assumed

The config expects the repo root to contain:

- `package.json` with:
  - `"start": "node server/server.js"`
  - dependencies already installed via `npm install`
- `server/server.js` (Express + Socket.io entry)
- `knexfile.js` and `migrations/` (for database schema)

These already exist in this project.

### 2. Render service configuration (from `render.yaml`)

Key pieces from `Deploy/render.yaml`:

- **type**: `web`
- **env**: `node`
- **buildCommand**:

  ```bash
  npm install
  npx knex migrate:latest
  ```

- **startCommand**:

  ```bash
  npm start
  ```

- **env vars**:
  - `NODE_ENV=production`
  - `DATABASE_URL` (set in Render dashboard; do **not** commit secrets)

### 3. Using this with Render

You have two options:

1. **Use Render's render.yaml directly**
   - Move or copy `Deploy/render.yaml` to the repo root as `render.yaml`.
   - Push to GitHub.
   - In Render, "New + → Blueprint", point to the repo; Render will auto-detect `render.yaml`.

2. **Manual service creation**
   - Create a new **Web Service** in Render, point it to your repo.
   - Set:
     - **Build Command**: `npm install && npx knex migrate:latest`
     - **Start Command**: `npm start`
   - Under **Environment**:
     - Add `NODE_ENV=production`
     - Add `DATABASE_URL=<your Neon URL>`

Once deployed, your backend will be reachable at the Render-provided URL on the port defined by Render (internally passed via `PORT`, which Express already reads via `config.js`).

