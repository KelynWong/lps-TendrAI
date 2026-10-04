# ---------------------------------------------------------------------------
# LPS-P2C — ACM certificate (item 3)
#
# DNS-validated certificate for var.domain_name. If var.route53_zone_id is
# provided, validation records are created automatically and Terraform waits
# for issuance. Otherwise create the CNAMEs shown in the
# `acm_validation_records` output in your external DNS, then re-apply.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "main" {
  count = var.enable_acm ? 1 : 0

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.name}-cert"
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = var.enable_acm && var.route53_zone_id != "" ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count = var.enable_acm && var.route53_zone_id != "" ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

locals {
  # Wait for validation when Route53 is managed here; otherwise use the raw
  # certificate ARN (it must be validated out-of-band before the HTTPS
  # listener becomes functional).
  certificate_arn = var.enable_acm ? (
    var.route53_zone_id != "" ? aws_acm_certificate_validation.main[0].certificate_arn : aws_acm_certificate.main[0].arn
  ) : null
}
