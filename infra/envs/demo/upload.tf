# Uploads the built app (frontend/legacy/app-v1/dist) into the bucket. Re-running apply after a
# rebuild re-uploads changed files (etag-driven); invalidate CloudFront after.

locals {
  mime_types = {
    html  = "text/html; charset=utf-8"
    css   = "text/css; charset=utf-8"
    js    = "application/javascript"
    json  = "application/json"
    svg   = "image/svg+xml"
    png   = "image/png"
    jpg   = "image/jpeg"
    jpeg  = "image/jpeg"
    gif   = "image/gif"
    ico   = "image/x-icon"
    txt   = "text/plain; charset=utf-8"
    map   = "application/json"
    woff  = "font/woff"
    woff2 = "font/woff2"
  }

  site_files = fileset(var.app_dist, "**")
}

resource "aws_s3_object" "site" {
  for_each = { for f in local.site_files : f => f }

  bucket = aws_s3_bucket.web.id
  key    = each.value
  source = "${var.app_dist}/${each.value}"
  etag   = filemd5("${var.app_dist}/${each.value}")

  content_type = lookup(
    local.mime_types,
    lower(element(split(".", each.value), length(split(".", each.value)) - 1)),
    "application/octet-stream",
  )
}
