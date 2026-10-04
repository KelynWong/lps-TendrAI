# ---------------------------------------------------------------------------
# LPS-P2C — Security groups (least-privilege traffic paths)
#
#   internet -> ALB (80/443) -> app (var.app_port) -> RDS (5432)
#   app -> VPC endpoints (443) and S3 gateway endpoint (443)
#   ALB -> internet 443 (only needed for the Cognito token endpoint)
# ---------------------------------------------------------------------------

# ----- ALB -------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  description = "Public-facing ALB: HTTP/HTTPS in, app tier out"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from anywhere (redirected to HTTPS when ACM is enabled)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to application targets"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

# Required for the ALB authenticate-cognito action: the ALB calls the Cognito
# token/userinfo endpoints over the internet.
resource "aws_vpc_security_group_egress_rule" "alb_to_cognito" {
  count = var.enable_cognito ? 1 : 0

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS egress for Cognito token endpoint"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# ----- Application (EC2) -----------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${local.name}-app-sg"
  description = "Application instances: ALB in, VPC endpoints/S3/RDS out. No SSH - use SSM Session Manager."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-app-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "App traffic from ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_endpoints" {
  security_group_id            = aws_security_group.app.id
  description                  = "HTTPS to interface VPC endpoints (Bedrock, Secrets Manager, KMS, logs, SSM...)"
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_s3" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS to S3 via gateway endpoint (documents, artifacts, AL2023 repos, CodeDeploy agent)"
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "PostgreSQL to RDS"
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# ----- RDS -------------------------------------------------------------------

resource "aws_security_group" "db" {
  name        = "${local.name}-db-sg"
  description = "RDS PostgreSQL: app tier in only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-db-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from application instances"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# ----- Interface VPC endpoints ----------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name}-vpce-sg"
  description = "Interface VPC endpoints: HTTPS from inside the VPC"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-vpce-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "vpce_https" {
  security_group_id = aws_security_group.vpc_endpoints.id
  description       = "HTTPS from within the VPC"
  cidr_ipv4         = var.vpc_cidr
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
