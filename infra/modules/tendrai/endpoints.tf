# ---------------------------------------------------------------------------
# TendrAI — VPC endpoints (diagram: "VPC Gateway endpoint" + "AWS PrivateLink")
#
# No NAT gateway: EC2 app instances and Lambdas reach AWS services
# exclusively via PrivateLink. The S3 gateway endpoint also carries the
# AL2023 dnf repos, the CodeDeploy agent installer and CI/CD artifacts.
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
# logs, monitoring, secretsmanager, kms, sqs, bedrock-runtime, ssm,
# ssmmessages, ec2messages, codedeploy, codedeploy-commands-secure — see
# locals.interface_endpoints. ENIs are placed in the private subnets; with
# private DNS every subnet in the VPC (EC2 app and workflow Lambdas)
# resolves them.

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoints)

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "${local.name}-${replace(each.key, ".", "-")}-endpoint"
  }
}
