output "demo_url" {
  description = "Share this with internal users (LPS network / VPN only)"
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "bucket" {
  description = "S3 bucket holding the built site"
  value       = aws_s3_bucket.web.id
}

output "distribution_id" {
  description = "CloudFront distribution id (for cache invalidation)"
  value       = aws_cloudfront_distribution.web.id
}

output "invalidate_command" {
  description = "Run after re-deploying a new build so users get it immediately"
  value       = "aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.web.id} --paths \"/*\""
}
