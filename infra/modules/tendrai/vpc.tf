# ---------------------------------------------------------------------------
# TendrAI — VPC (diagram: VPC CIDR 172.16.0.0/16)
#
# 172.16.0.0/16 across 2 AZs in ap-southeast-1, three subnet tiers:
#   * public   : ALB only.
#   * private  : EC2 app instances (ASG), RDS, status-updater Lambda.
#   * workflow : Step Functions Lambdas (text extractors, normalizer,
#                analyser, result loader).
# No NAT gateway — private egress to AWS services is via the S3 gateway
# endpoint and PrivateLink interface endpoints (endpoints.tf).
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-igw"
  }
}

# ----- Subnets ---------------------------------------------------------------

resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count = var.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.private_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

resource "aws_subnet" "workflow" {
  count = var.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.workflow_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name}-workflow-${local.azs[count.index]}"
    Tier = "workflow"
  }
}

# ----- Routing ---------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-public-rt"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count = var.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private route table has no default route (no NAT, no IGW). AWS service
# access is via the S3 gateway endpoint (route injected by the endpoint) and
# interface endpoints (ENIs inside the subnets). Shared by both private tiers.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-private-rt"
  }
}

resource "aws_route_table_association" "private" {
  count = var.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "workflow" {
  count = var.az_count

  subnet_id      = aws_subnet.workflow[count.index].id
  route_table_id = aws_route_table.private.id
}
