from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("geocode/", views.geocode, name="geocode"),
    path("geocode/suggest/", views.geocode_suggest, name="geocode-suggest"),
    path("reverse-geocode/", views.reverse_geocode, name="reverse-geocode"),
    path("plan/", views.plan, name="plan"),
    path("heatmap/", views.heatmap, name="heatmap"),
]
