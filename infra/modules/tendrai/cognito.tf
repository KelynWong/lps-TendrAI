# ---------------------------------------------------------------------------
# TendrAI — Cognito (diagram item 3)
#
# User pool + app client + hosted UI domain. Groups match the TendrAI project
# roles. The ALB HTTPS listener performs authenticate-cognito before
# forwarding to the app (see alb.tf) — the app receives identity via the
# x-amzn-oidc-* headers.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "main" {
  count = var.enable_cognito ? 1 : 0

  name = "${local.name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Internal system: admins create users, no self sign-up.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  tags = {
    Name = "${local.name}-users"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  count = var.enable_cognito ? 1 : 0

  domain       = local.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main[0].id
}

resource "aws_cognito_user_pool_client" "alb" {
  count = var.enable_cognito ? 1 : 0

  name         = "${local.name}-alb-client"
  user_pool_id = aws_cognito_user_pool.main[0].id

  # The ALB authenticate-cognito action requires a confidential client
  # (client secret) using the authorization-code grant.
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  # The ALB handles the OIDC redirect on this well-known path.
  callback_urls = ["https://${var.domain_name}/oauth2/idpresponse"]
  logout_urls   = ["https://${var.domain_name}/"]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 8

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
}

# One user pool group per project role.
resource "aws_cognito_user_group" "roles" {
  for_each = var.enable_cognito ? toset(local.cognito_groups) : toset([])

  name         = each.key
  user_pool_id = aws_cognito_user_pool.main[0].id
  description  = "TendrAI role: ${each.key}"
}
