# Weather-Aware Truck Routing

A React + Django application that helps a truck driver pick the safest route
between an origin and destination, factoring in forecasted wind/rain/snow and
the truck's load weight.

## How it works

1. **Routing & geocoding** — [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/)
   generates alternative driving routes; [Mapbox Geocoding](https://docs.mapbox.com/api/search/geocoding/)
   resolves the origin/destination text into coordinates. Mapbox's
   `alternatives=true` is documented as returning "up to two" alternates,
   but for a simple intercity pair dominated by one interstate corridor it
   often returns only one (two routes total). When that happens, we make a
   second request with `exclude=motorway` to find a genuinely different
   third route (e.g. a state-highway path) and merge in the first result
   that isn't a near-duplicate of what we already have — see
   [`get_routes`](backend/routing/mapbox_client.py). If the road network
   truly offers no third distinct path (e.g. same origin and destination),
   we return what's available rather than fabricate a route.
2. **Checkpoint sampling** — each route's geometry is walked and checkpoints
   are sampled at **10 mi** intervals for the first 100 miles, **25 mi**
   intervals from 100–300 miles, and **50 mi** intervals beyond that. This is
   our interpretation of the brief's "sample weather every 10 / 25 / 50
   miles": fine-grained resolution near departure (where forecasts are most
   reliable and route decisions matter most), coarser further out, keeping
   the number of weather API calls bounded on long-haul routes. See
   [`backend/routing/geometry.py`](backend/routing/geometry.py).
3. **ETA per checkpoint** — computed from Mapbox's per-segment duration
   annotations along the route geometry, added to the user's departure time.
4. **Weather** — [Open-Meteo](https://open-meteo.com/) (free, no API key)
   hourly forecasts are fetched in a single batched request for every
   checkpoint across all routes, then each checkpoint's weather at its ETA
   is looked up (nearest-hour).
5. **Risk classification** — wind/rain/snow thresholds classify each
   checkpoint as Low/Moderate/High/Severe/No Travel, with load-weight
   escalation rules applied on top (see `backend/routing/risk.py`).
6. **Recommendation** — routes are ranked by: fewest No Travel miles → fewest
   Severe miles → fewest High miles → lowest average risk → shortest travel
   time (`backend/routing/recommendation.py`). The first criterion isn't in
   the brief's four, but is necessary: No Travel means the truck shouldn't
   proceed at all, so a route with *any* No Travel exposure must never
   outrank one without it just because its raw mileage happens to be
   smaller (e.g. 5mi of No Travel is not "better" than 10mi of merely-risky
   Severe). Among routes tied on No Travel exposure, the brief's four
   criteria apply exactly as stated. Mileage-at-risk is attributed by
   treating each checkpoint's risk as representative of the segment running
   to the next checkpoint.
7. **Map & heatmap** — the frontend renders all 3 routes, color-coded
   checkpoints labeled with their mile marker, distinct origin/destination
   pins labeled with the resolved place name, and a weather-risk heatmap
   along the selected route's corridor (sampled every 20 mi) with a 0–48h
   forecast slider, powered by a dedicated `/api/heatmap/` endpoint so
   scrubbing the slider doesn't refetch from the network. Clicking a
   checkpoint lazily reverse-geocodes it (cached client-side) so its popup
   shows the nearest named place alongside ETA, risk level and weather
   detail. Zoom controls, a scale bar, and a basemap switcher (Streets /
   Light / Satellite / Terrain / Dark) are built into the map.

## Project layout

```
backend/    Django + Django REST Framework API (stateless, no DB writes)
frontend/   React + TypeScript + Vite, Mapbox GL via react-map-gl
```

## Running locally

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in MAPBOX_TOKEN
python manage.py migrate
python manage.py test routing   # 14 unit tests covering risk/recommendation logic
python manage.py runserver
```

Backend runs at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # then fill in VITE_MAPBOX_TOKEN
npm run dev
```

Frontend runs at `http://localhost:5173`.

### Getting a Mapbox token

1. Sign up free at [mapbox.com](https://www.mapbox.com) (no credit card required).
2. Go to `account.mapbox.com` → **Access tokens** → copy the **Default public token** (`pk....`).
3. Put it in both `backend/.env` (`MAPBOX_TOKEN`) and `frontend/.env` (`VITE_MAPBOX_TOKEN`).

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/geocode/?query=...` | GET | Resolve free-text place name to `{lat, lon, label}` |
| `/api/reverse-geocode/?lat=...&lon=...` | GET | Resolve coordinates to a place label (used lazily for checkpoint popups) |
| `/api/plan/` | POST | Full route plan: 3 routes, checkpoints, risk, recommendation |
| `/api/heatmap/` | POST | Corridor weather-risk grid for a single route, hours 0–48 |
| `/api/health/` | GET | Liveness check |

`POST /api/plan/` request body:
```json
{
  "origin": {"lat": 39.0997, "lon": -94.5786, "label": "Kansas City, MO"},
  "destination": {"lat": 39.7392, "lon": -104.9903, "label": "Denver, CO"},
  "departure_time": "2026-11-10T14:00:00Z",
  "load_weight_lb": 34000
}
```

## Risk rules implemented

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | <25 mph | 25–34 | 35–44 | 45–54 | ≥55 mph |
| Rain | <0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00 |
| Snow | <0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | >3.0 |

Load escalation (applied after the base classification above, never
downgrades a higher base risk):
- Wind ≥55 mph → No Travel, any load
- Wind 45–54 mph + load >30,000 lb → No Travel
- Wind 35–44 mph + load >40,000 lb → Severe

A checkpoint's overall risk is the max of its wind/rain/snow levels, then
the load rules are applied on top.

## Deployment

### Backend → Render

A `render.yaml` is included. From the Render dashboard: **New → Blueprint**,
point it at this repo, it'll pick up `backend/render.yaml`. After the first
deploy, set the `MAPBOX_TOKEN` and `CORS_ALLOWED_ORIGINS` (your frontend's
URL) env vars in the Render dashboard — they're marked `sync: false` so
Render won't auto-fill them.

### Frontend → Cloudflare Workers

```bash
cd frontend
npx wrangler login
VITE_MAPBOX_TOKEN=pk.xxx VITE_API_BASE_URL=https://your-backend.onrender.com npm run deploy
```

`VITE_*` vars are baked into the static bundle at build time, so they must
be set in the shell (or a `.env.production` file) before `npm run deploy`,
not as Cloudflare runtime secrets. `wrangler.jsonc` configures the Worker
to serve `frontend/dist` as a single-page app.

After both are deployed, update the backend's `CORS_ALLOWED_ORIGINS` env var
on Render to include your `*.workers.dev` URL (or custom domain), and redeploy.

## Assumptions & design notes

- **Statelessness**: the backend holds no database state — every `/api/plan/`
  call re-fetches routing + weather live. This keeps the app simple and
  correct (no stale cached forecasts) at the cost of repeat API calls if a
  user re-submits the same trip.
- **Departure time** is treated as UTC end-to-end (the `datetime-local`
  input is converted via `new Date(...).toISOString()`, i.e. interpreted in
  the browser's local timezone, then sent as UTC). This avoids ambiguity
  around the truck's timezone changing en route.
- **Forecast horizon**: Open-Meteo provides up to 16 days hourly. Checkpoints
  whose ETA falls beyond that window are marked `forecast_available: false`
  and treated as Low risk (clearly flagged in the UI) rather than blocking
  the whole route.
- **Mileage-at-risk** for ranking is attributed per-segment from each
  checkpoint to the next (see point 6 above) rather than requiring
  continuous weather sampling, which the brief doesn't ask for.

## Deliverables checklist

- [x] GitHub repository (push this repo)
- [ ] Hosted application (deploy steps above)
- [ ] 5–10 min Loom walkthrough — record after deploying, covering: entering
      a trip, the 3 routes + checkpoints on the map, the recommendation
      logic, and the weather heatmap slider.
