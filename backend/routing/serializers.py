from rest_framework import serializers


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, default="")


class PlanRequestSerializer(serializers.Serializer):
    origin = LocationSerializer()
    destination = LocationSerializer()
    departure_time = serializers.DateTimeField()
    load_weight_lb = serializers.FloatField(min_value=0)


class GeocodeRequestSerializer(serializers.Serializer):
    query = serializers.CharField(min_length=2)


class ReverseGeocodeRequestSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class HeatmapRequestSerializer(serializers.Serializer):
    geometry = serializers.DictField()
    distances_m = serializers.ListField(child=serializers.FloatField())
    durations_s = serializers.ListField(child=serializers.FloatField())
    departure_time = serializers.DateTimeField()
    load_weight_lb = serializers.FloatField(min_value=0)
