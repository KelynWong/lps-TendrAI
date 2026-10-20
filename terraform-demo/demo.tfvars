# Copy to demo.tfvars.

# --- Access mode -------------------------------------------------------------
# PUBLIC for now (anyone with the URL). Flip to true + fill allowed_cidrs once
# IT provides the LPS egress ranges, then terraform apply again.
restrict_to_lps = false

# When restrict_to_lps = true, include every office breakout AND the VPN
# egress range, or users working from home on VPN will be blocked.
# allowed_cidrs = [
#   "203.0.113.0/24",  # LPS Singapore office egress
#   "198.51.100.7/32", # LPS VPN egress
# ]

# region      = "ap-southeast-1"
# app_dist    = "../app/dist"
# price_class = "PriceClass_200"
