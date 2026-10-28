# CloudFront in front of the private bucket, with the internal-only WAF.

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project}-oac"
  description                       = "OAC for the TendrAI demo bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "TendrAI demo (internal LPS users only)"
  default_root_object = "index.html"
  price_class         = var.price_class
  # Public when restrict_to_lps = false; internal-only WAF otherwise
  web_acl_id = var.restrict_to_lps ? aws_wafv2_web_acl.demo[0].arn : null

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed policy: CachingOptimized
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA fallback: unknown paths (S3 404 thanks to ListBucket) load the app.
  # 403 is deliberately NOT mapped - see waf.tf.
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
