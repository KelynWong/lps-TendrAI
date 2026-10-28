# ---------------------------------------------------------------------------
# TendrAI — Security groups (least-privilege traffic paths)
#
#   internet -> ALB (443; 80 only redirects to 443) -> EC2 app (app_port)
#   EC2 app / Lambdas -> interface VPC endpoints (443), S3 gateway (443)
#   EC2 app + status_updater + result_loader Lambdas -> RDS (5432)
#   ALB -> internet 443 (Cognito token endpoint only)
#
# One security group per diagram box: ALB, EC2 app, RDS, each Lambda,
# endpoints.
# ---------------------------------------------------------------------------

# ----- ALB -------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  description = "Public-facing ALB: HTTPS in (HTTP redirect only), EC2 app instances out"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-alb-sg"
  }
}

# Port 80 only serves the 301 redirect to HTTPS (alb.tf http_redirect); it
# forwards to the app only when enable_acm = false (local emulator).
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from anywhere: redirect to HTTPS only"
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
  description                  = "Forward to EC2 application instances"
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

# ----- EC2 application instances --------------------------------------------

resource "aws_security_group" "app" {
  name        = "${local.name}-app-sg"
  description = "EC2 app instances: ALB in on the app port; VPC endpoints, S3 and RDS out"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-app-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "App traffic from the ALB only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_endpoints" {
  security_group_id            = aws_security_group.app.id
  description                  = "HTTPS to interface VPC endpoints (Secrets Manager, SQS, logs, monitoring, KMS, SSM, CodeDeploy)"
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_s3" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS to S3 via gateway endpoint (documents, CI/CD artifacts, AL2023 repos, CodeDeploy agent)"
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

# ----- Workflow Lambdas (one SG per function, as drawn) ----------------------

resource "aws_security_group" "lambda" {
  for_each = local.lambda_functions

  name        = "${local.name}-${replace(each.key, "_", "-")}-sg"
  description = "Lambda ${each.key}: VPC endpoints and S3 out${each.value.needs_db ? ", RDS out" : ""}"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-${replace(each.key, "_", "-")}-sg"
  }
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_endpoints" {
  for_each = local.lambda_functions

  security_group_id            = aws_security_group.lambda[each.key].id
  description                  = "HTTPS to interface VPC endpoints (Secrets Manager, KMS, logs, Bedrock)"
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_s3" {
  for_each = local.lambda_functions

  security_group_id = aws_security_group.lambda[each.key].id
  description       = "HTTPS to S3 via gateway endpoint"
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_db" {
  for_each = { for k, v in local.lambda_functions : k => v if v.needs_db }

  security_group_id            = aws_security_group.lambda[each.key].id
  description                  = "PostgreSQL to RDS"
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# ----- RDS -------------------------------------------------------------------
# Inbound only from the EC2 app SG and the DB-writing Lambdas (needs_db:
# status_updater and result_loader).

resource "aws_security_group" "db" {
  name        = "${local.name}-db-sg"
  description = "RDS PostgreSQL: EC2 app instances and DB-writing Lambdas in only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-db-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from EC2 application instances"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_lambda" {
  for_each = { for k, v in local.lambda_functions : k => v if v.needs_db }

  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from Lambda ${each.key}"
  referenced_security_group_id = aws_security_group.lambda[each.key].id
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
