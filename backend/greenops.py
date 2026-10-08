# GreenOps Carbon Footprint Calculator tailored for Indian AWS Data Centre Regions

# Carbon Intensity Factor for India Grid Regions (kg CO2 per kWh)
# ap-south-1 (Mumbai) & ap-south-2 (Hyderabad)
INDIA_GRID_CO2_KG_PER_KWH = 0.708 

def calculate_greenops_metrics(idle_resources: list) -> dict:
    total_co2_kg = sum(r.get('est_co2_kg_monthly', 0) for r in idle_resources)
    total_kwh_saved = total_co2_kg / INDIA_GRID_CO2_KG_PER_KWH if INDIA_GRID_CO2_KG_PER_KWH else 0
    trees_equivalent = round(total_co2_kg / 21.77, 1) # ~21.77 kg CO2 absorbed per tree/year
    
    return {
        "monthly_co2_kg_saved": round(total_co2_kg, 2),
        "estimated_kwh_reduced": round(total_kwh_saved, 2),
        "annual_trees_equivalent": trees_equivalent,
        "primary_region": "ap-south-1 (Mumbai)",
        "secondary_region": "ap-south-2 (Hyderabad)"
    }
