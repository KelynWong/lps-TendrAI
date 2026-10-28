# ---------------------------------------------------------------------------
# TendrAI — RDS PostgreSQL 16 (diagram item 5)
#
# * Private subnets only, never publicly accessible. Clients: EC2 app,
#   status-updater Lambda, result-loader Lambda (security_groups.tf).
# * Storage encrypted with the data CMK; TLS enforced via rds.force_ssl.
# * Master credentials are generated and rotated by RDS itself
#   (manage_master_user_password) and stored in Secrets Manager, encrypted
#   with the data CMK. Operators only; the EC2 app and the DB Lambdas log in
#   with their own db_role secrets (secrets.tf).
# * pgvector: the extension binaries ship with RDS PostgreSQL — the
#   application enables it at bootstrap with `CREATE EXTENSION IF NOT EXISTS
#   vector;`. No infrastructure action required here.
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name}-db-subnets"
  }
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "${local.name}-pg16-"
  family      = "postgres16"
  description = "TendrAI PostgreSQL 16 parameters (TLS enforced)"

  # Encryption in transit: reject non-TLS connections.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier = "${local.name}-postgres"

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username

  # RDS-managed master password in Secrets Manager (encrypted with our CMK).
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.data.arn

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.data.arn

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.enable_multi_az
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period    = var.db_backup_retention_days
  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name}-postgres-final"

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = {
    Name = "${local.name}-postgres"
  }
}
