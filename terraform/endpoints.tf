# ---------------------------------------------------------------------------
# LPS-P2C — VPC endpoints (items 7 & 8)
#
# No NAT gateway: the private app tier reaches AWS services exclusively via
# PrivateLink. The S3 gateway endpoint also carries Amazon Linux 2023 package
# repos and the CodeDeploy agent installer (both served from regional S3).
# ---------------------------------------------------------------------------

# ----- S3 gateway endpoint ---------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = {
    Name = "${local.name}-s3-gw-endpoint"
  }
}

# ----- Interface endpoints (PrivateLink) ------------------------------------
# bedrock-runtime, secretsmanager, kms, logs, monitoring, ssm, ssmmessages,
# ec2messages — see locals.interface_endpoints.

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoints)

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "${local.name}-${each.key}-endpoint"
  }
}
