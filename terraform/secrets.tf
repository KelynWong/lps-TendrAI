# ---------------------------------------------------------------------------
# LPS-P2C — Secrets Manager (item 14)
#
# * App config secret: placeholder JSON the operators fill in after deploy
#   (API keys, app-level settings...). The version below is created once and
#   subsequent value changes made outside Terraform are ignored.
# * DB master secret: created and rotated BY RDS via
#   manage_master_user_password (see rds.tf) — deliberately not defined here
#   so there is exactly one source of truth for DB credentials.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app_config" {
  name_prefix = "${local.name}-app-config-"
  description = "LPS-P2C application configuration (placeholder — populate real values out-of-band)"
  kms_key_id  = aws_kms_key.data.arn

  recovery_window_in_days = 7

  tags = {
    Name = "${local.name}-app-config"
  }
}

resource "aws_secretsmanager_secret_version" "app_config" {
  secret_id = aws_secretsmanager_secret.app_config.id

  secret_string = jsonencode({
    placeholder            = "replace-me"
    bedrock_embed_model_id = "amazon.titan-embed-text-v2:0"
    bedrock_gen_model_id   = "anthropic.claude-3-5-sonnet-20241022-v2:0"
  })

  lifecycle {
    # Operators manage the real values in the console/CLI; don't fight them.
    ignore_changes = [secret_string]
  }
}
