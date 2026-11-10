# Weather-Aware Truck Routing

A React + Django application that helps a truck driver choose the safest
route between an origin and destination, balancing forecasted wind, rain,
and snow against the truck's load weight and travel time.

**Live app:** https://truck-routing-frontend.princesaxena.workers.dev
**API:** https://truck-routing-api-pjek.onrender.com (free Render tier — the
first request after a period of inactivity can take ~30–60s to wake up)

## Overview

The driver enters an origin, destination, departure time, and load weight.
The app generates three alternative driving routes, samples the forecast
at checkpoints along each one using the truck's actual estimated arrival
time (not just current conditions), classifies the risk at every
checkpoint against a fixed threshold table plus load-weight escalation
rules, and recommends the route that best balances risk against travel
time — all rendered on an interactive map with a live weather heatmap.

## How it works

1. **Routing & geocoding** — [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/)
   generates alternative driving routes; [Mapbox Geocoding](https://docs.mapbox.com/api/search/geocoding/)
   resolves place names to coordinates, both for the origin/destination
   form fields (with a live typeahead dropdown) and for reverse-geocoding
   a checkpoint into a readable place name on hover.

   Mapbox's `alternatives=true` is documented as returning "up to two"
   alternates, but for a trip dominated by a single interstate corridor it
   often returns only one (two routes total). When that happens, a second
   request with `exclude=motorway` finds a genuinely different third route
   (e.g. a state-highway detour) and merges in the first result that isn't
   a near-duplicate of what's already there — see
   [`get_routes`](backend/routing/mapbox_client.py). If the road network
   truly offers no third distinct path (e.g. origin equals destination),
   the app returns what's available rather than fabricate a route.

2. **Checkpoint sampling** — each route's geometry is walked and
   checkpoints are sampled at **10 mi** intervals for the first 100 miles,
   **25 mi** intervals from 100–300 miles, and **50 mi** intervals beyond
   that. This is the interpretation of the brief's "sample weather every
   10 / 25 / 50 miles": fine-grained resolution near departure, where
   forecasts are most reliable and route decisions matter most, coarser
   further out, keeping the number of weather API calls bounded on
   long-haul routes. See [`geometry.py`](backend/routing/geometry.py).

3. **ETA per checkpoint** — computed from Mapbox's per-segment duration
   annotations along the route geometry, added to the departure time.

4. **Weather** — [Open-Meteo](https://open-meteo.com/) (free, no API key)
   hourly forecasts are fetched in a single batched request for every
   checkpoint across all routes, then each checkpoint's weather at its ETA
   is looked up. Requests retry with backoff on transient failures (e.g. a
   rate-limited response) before surfacing a clean error.

5. **Risk classification** — wind/rain/snow thresholds classify each
   checkpoint as Low, Moderate, High, Severe, or No Travel, with the
   load-weight escalation rules applied on top. See
   [`risk.py`](backend/routing/risk.py) and the exact table below.

6. **Recommendation** — routes are ranked by: fewest No Travel miles →
   fewest Severe miles → fewest High miles → lowest average risk →
   shortest travel time. See [`recommendation.py`](backend/routing/recommendation.py)
   for why No Travel exposure is checked first, ahead of the brief's own
   four criteria: No Travel means the truck shouldn't proceed through that
   segment at all, so a route with *any* No Travel exposure must never
   outrank one without it just because its raw mileage happens to be
   smaller. Mileage-at-risk is attributed by treating each checkpoint's
   risk as representative of the segment running to the next checkpoint.

7. **Map** — all three routes, risk-colored checkpoints, and labeled
   origin/destination pins render on an interactive Mapbox map. Before a
   trip is planned, the map shows a slowly rotating globe; submitting a
   trip flies smoothly from the full-earth view into the route corridor.
   A basemap switcher (Streets / Light / Satellite / Terrain / Dark), zoom
   controls, and a scale bar are built in.

8. **Weather heatmap** — a corridor-wide risk heatmap for the selected
   route, sampled every 20 mi, with a 0–48 hour forecast slider. A
   dedicated `/api/heatmap/` endpoint returns the full 49-hour series in
   one response, so dragging the slider re-renders instantly with no
   network round-trip.

## Project layout

```
backend/    Django + Django REST Framework API (stateless — no database writes)
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
python manage.py test routing   # 19 unit tests covering risk & recommendation logic
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
| `/api/geocode/?query=...` | GET | Resolve a finished place-name query to one `{lat, lon, label}` match |
| `/api/geocode/suggest/?query=...&limit=5` | GET | Live typeahead: up to `limit` candidate matches for an in-progress query |
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

Note the No Travel boundary differs by condition: wind's is inclusive
(`≥55 mph`), while rain's and snow's are strict (`>1.00`, `>3.0`) — a
reading of exactly 1.00 in/hr rain or 3.0 in/hr snow is still Severe, not
No Travel. The implementation matches this exactly; see the boundary
sweep in [`tests.py`](backend/routing/tests.py).

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
  call re-fetches routing and weather live. This keeps the app simple and
  correct (no stale cached forecasts) at the cost of repeat API calls if a
  user re-submits the same trip. The only database usage at all is Django's
  own `auth`/`contenttypes` bookkeeping tables, which Django REST Framework
  depends on internally even with no authentication configured — the app
  itself persists nothing.
- **Departure time** is treated as UTC end-to-end (the date/time picker's
  local value is converted via `new Date(...).toISOString()`, i.e.
  interpreted in the browser's local timezone, then sent as UTC). This
  avoids ambiguity around the truck's timezone changing en route. Past
  departure times are rejected both client- and server-side, since
  Open-Meteo has no historical "forecast" to look up.
- **Forecast horizon**: Open-Meteo provides up to 16 days hourly. Checkpoints
  whose ETA falls beyond that window are marked `forecast_available: false`
  and treated as Low risk (clearly flagged in the UI) rather than blocking
  the whole route.
- **Mileage-at-risk** for ranking is attributed per-segment from each
  checkpoint to the next, rather than requiring continuous weather
  sampling, which the brief doesn't ask for.
- **Geocoding relevance**: Mapbox's geocoder always returns its best fuzzy
  guess, even for a nonsense query. A low-relevance top match is rejected
  with a clear "not found" error instead of silently routing to an
  unrelated real place.

## Testing

The backend's 19 unit tests ([`tests.py`](backend/routing/tests.py)) cover
every threshold boundary in the risk table (including the wind-vs-rain/snow
No Travel asymmetry), all three load-escalation rules, tiered checkpoint
spacing, and the route-recommendation ranking order — including the case
that specifically guards against a route with No Travel exposure ever
outranking a merely-Severe one on raw mileage alone.

```bash
cd backend && python manage.py test routing -v 2
```

The full pipeline has also been verified against live data end-to-end,
including real weather events found by searching globally for current
storm conditions (e.g. a genuine Severe-rated rain band over
Visakhapatnam, India, and a Severe-via-load-rule wind event near Dodge
City, Kansas) — not just synthetic test fixtures.
