# Internal-only access: the Web ACL blocks everything by default and allows
# only the LPS network egress ranges. Blocked requests get a custom 401 (NOT
# 403) so CloudFront's SPA error mapping never serves the app to outsiders.

resource "aws_wafv2_ip_set" "lps_network" {
  count    = var.restrict_to_lps ? 1 : 0
  provider = aws.us_east_1

  name               = "${var.project}-lps-network"
  description        = "LPS office and VPN egress ranges allowed to view the demo"
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = var.allowed_cidrs
}

resource "aws_wafv2_web_acl" "demo" {
  count    = var.restrict_to_lps ? 1 : 0
  provider = aws.us_east_1

  name        = "${var.project}-internal-only"
  description = "Allow LPS network only; block everyone else"
  scope       = "CLOUDFRONT"

  default_action {
    block {
      custom_response {
        response_code = 401
      }
    }
  }

  rule {
    name     = "allow-lps-network"
    priority = 1

    action {
      allow {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.lps_network[0].arn
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-allow-lps-network"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-internal-only"
    sampled_requests_enabled   = true
  }
}
