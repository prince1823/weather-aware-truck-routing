from datetime import datetime, timezone

from django.test import SimpleTestCase

from .geometry import build_cumulative_points, sample_checkpoints
from .recommendation import CheckpointResult, rank_routes, summarize_route
from .risk import RiskLevel, WeatherSample, classify_checkpoint_risk


class RiskClassificationTests(SimpleTestCase):
    def test_low_wind_rain_snow(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=10, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.LOW)

    def test_moderate_wind(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=30, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.MODERATE)

    def test_high_rain_dominates(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=10, rain_in_hr=0.30, snow_in_hr=0.0), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.HIGH)

    def test_severe_snow(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=0, rain_in_hr=0.0, snow_in_hr=2.5), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)

    def test_no_travel_wind_55_any_load(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=55, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=1_000)
        self.assertEqual(result.level, RiskLevel.NO_TRAVEL)

    def test_no_travel_wind_45_54_heavy_load(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=48, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=35_000)
        self.assertEqual(result.level, RiskLevel.NO_TRAVEL)

    def test_wind_45_54_light_load_not_escalated_to_no_travel(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=48, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)  # base classification for 45-54 wind, no load escalation

    def test_severe_wind_35_44_heavy_load(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=38, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=45_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)

    def test_wind_35_44_light_load_not_escalated(self):
        result = classify_checkpoint_risk(WeatherSample(wind_mph=38, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=20_000)
        self.assertEqual(result.level, RiskLevel.HIGH)  # base classification for 35-44 wind, no load escalation

    def test_wind_no_travel_boundary_is_inclusive(self):
        # Brief: Wind No Travel is ">=55 mph" -- exactly 55 is No Travel.
        result = classify_checkpoint_risk(WeatherSample(wind_mph=55, rain_in_hr=0.0, snow_in_hr=0.0), load_lb=10_000)
        self.assertEqual(result.level, RiskLevel.NO_TRAVEL)

    def test_rain_no_travel_boundary_is_exclusive(self):
        # Brief: Rain No Travel is ">1.00 in/hr" (strict) -- exactly 1.00 is still Severe.
        result = classify_checkpoint_risk(WeatherSample(wind_mph=0, rain_in_hr=1.00, snow_in_hr=0.0), load_lb=10_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)
        result = classify_checkpoint_risk(WeatherSample(wind_mph=0, rain_in_hr=1.01, snow_in_hr=0.0), load_lb=10_000)
        self.assertEqual(result.level, RiskLevel.NO_TRAVEL)

    def test_snow_no_travel_boundary_is_exclusive(self):
        # Brief: Snow No Travel is ">3.0 in/hr" (strict) -- exactly 3.0 is still Severe.
        result = classify_checkpoint_risk(WeatherSample(wind_mph=0, rain_in_hr=0.0, snow_in_hr=3.0), load_lb=10_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)
        result = classify_checkpoint_risk(WeatherSample(wind_mph=0, rain_in_hr=0.0, snow_in_hr=3.01), load_lb=10_000)
        self.assertEqual(result.level, RiskLevel.NO_TRAVEL)

    def test_load_rule_never_downgrades_existing_higher_risk(self):
        # Heavy rain alone is already Severe; a 35-44mph+heavy-load escalation to Severe shouldn't downgrade it.
        result = classify_checkpoint_risk(WeatherSample(wind_mph=38, rain_in_hr=0.80, snow_in_hr=0.0), load_lb=45_000)
        self.assertEqual(result.level, RiskLevel.SEVERE)


class CheckpointSamplingTests(SimpleTestCase):
    def test_tiered_spacing(self):
        # A straight line of 1 degree longitude at the equator ~= 69 miles/degree;
        # build a simple two-point route long enough to cross all three tiers.
        coordinates = [[0.0, 0.0], [6.0, 0.0]]  # ~414 miles
        total_m = 414 * 1609.344
        distances_m = [total_m]
        durations_s = [414 * 3600 / 60]  # 60 mph
        points = build_cumulative_points(coordinates, distances_m, durations_s)
        checkpoints = sample_checkpoints(points)

        distances = [round(c.distance_mi) for c in checkpoints]
        self.assertEqual(distances[0], 0)
        self.assertIn(10, distances)
        self.assertIn(100, distances)
        self.assertIn(125, distances)  # 100 + 25
        self.assertEqual(distances[-1], round(points[-1].distance_mi))
        # strictly increasing
        self.assertEqual(distances, sorted(set(distances)))


class RecommendationTests(SimpleTestCase):
    def _cp(self, distance_mi, risk_level):
        return CheckpointResult(
            lat=0, lon=0, distance_mi=distance_mi, eta="2026-01-01T00:00:00Z",
            risk_level=risk_level, reason="", wind_mph=0, rain_in_hr=0, snow_in_hr=0,
            forecast_available=True,
        )

    def test_summarize_route_mileage_attribution(self):
        checkpoints = [self._cp(0, "Low"), self._cp(10, "Severe"), self._cp(20, "Low")]
        summary = summarize_route(checkpoints, total_distance_mi=20, duration_s=1200)
        self.assertEqual(summary.severe_miles, 10.0)
        self.assertEqual(summary.no_travel_miles, 0.0)
        self.assertEqual(summary.overall_risk, "Severe")

    def test_rank_routes_prefers_fewer_severe_miles(self):
        safe = summarize_route([self._cp(0, "Low"), self._cp(50, "Low")], 50, 3600)
        risky = summarize_route([self._cp(0, "Severe"), self._cp(50, "Low")], 50, 3600)
        ranking = rank_routes([risky, safe])
        self.assertEqual(ranking[0], 1)  # the safe route (index 1) should rank first

    def test_rank_routes_falls_back_to_duration(self):
        fast = summarize_route([self._cp(0, "Low"), self._cp(50, "Low")], 50, 1000)
        slow = summarize_route([self._cp(0, "Low"), self._cp(50, "Low")], 50, 5000)
        ranking = rank_routes([slow, fast])
        self.assertEqual(ranking[0], 1)

    def test_no_travel_always_outranked_even_with_fewer_bad_miles(self):
        # 5mi of No Travel (categorically impassable) must never beat
        # 10mi of merely-risky Severe, even though 5 < 10.
        few_no_travel = summarize_route([self._cp(0, "Low"), self._cp(5, "No Travel"), self._cp(10, "Low")], 10, 1000)
        lots_of_severe = summarize_route([self._cp(0, "Low"), self._cp(10, "Severe"), self._cp(20, "Low")], 20, 1000)
        ranking = rank_routes([few_no_travel, lots_of_severe])
        self.assertEqual(ranking[0], 1)  # the Severe-only route (index 1) should rank first

    def test_no_travel_miles_zero_when_route_is_clean(self):
        checkpoints = [self._cp(0, "Low"), self._cp(50, "Moderate")]
        summary = summarize_route(checkpoints, total_distance_mi=50, duration_s=3600)
        self.assertEqual(summary.no_travel_miles, 0.0)
