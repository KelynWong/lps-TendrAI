# ---------------------------------------------------------------------------
# LPS-P2C — WAFv2 (item 2)
#
# Regional Web ACL in front of the ALB:
#   * AWSManagedRulesCommonRuleSet     — OWASP-style common threats
#   * AWSManagedRulesKnownBadInputsRuleSet — known exploit payloads (log4j...)
#   * Rate-based rule                  — per-IP request throttling
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "main" {
  count = var.enable_waf ? 1 : 0

  name        = "${local.name}-web-acl"
  description = "Protects the LPS-P2C ALB"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common-rule-set"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common-rule-set"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 30

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${local.name}-web-acl"
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main[0].arn
}
