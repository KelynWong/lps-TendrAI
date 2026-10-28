variable "project" {
  description = "Resource name prefix (lowercase, S3-safe)"
  type        = string
  default     = "lps-tendrai-demo"
}

variable "project_tag" {
  description = "Project tag applied to every resource"
  type        = string
  default     = "TendrAI"
}

variable "region" {
  description = "Home region for the S3 bucket (NFR05)"
  type        = string
  default     = "ap-southeast-1"
}

variable "restrict_to_lps" {
  description = <<-EOT
    true  = internal only: WAF blocks everything except allowed_cidrs (401).
    false = public: no WAF, anyone with the URL can view the demo.
    Flipping this later is just a terraform apply.
  EOT
  type        = bool
  default     = true
}

variable "allowed_cidrs" {
  description = <<-EOT
    Public egress CIDR ranges of the LPS network (offices + VPN). Only used
    when restrict_to_lps = true. Ask IT for the authoritative list - and
    remember users on home networks must be on the corporate VPN.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = !var.restrict_to_lps || length(var.allowed_cidrs) > 0
    error_message = "restrict_to_lps = true needs at least one CIDR, e.g. [\"203.0.113.0/24\"] - or set restrict_to_lps = false for a public demo."
  }
}

variable "app_dist" {
  description = "Path to the built web app (run 'npm run build' in frontend/legacy/app-v1 first)"
  type        = string
  default     = "../../../frontend/legacy/app-v1/dist"
}

variable "price_class" {
  description = "CloudFront price class (PriceClass_200 includes Asia Pacific)"
  type        = string
  default     = "PriceClass_200"
}
