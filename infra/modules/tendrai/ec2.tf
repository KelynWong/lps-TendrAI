# ---------------------------------------------------------------------------
# TendrAI — Application tier: EC2 Auto Scaling group (diagram item 4)
#
# Launch template + Auto Scaling group in the private subnets, Amazon Linux
# 2023, running the web application and API server together behind the ALB.
#   * IMDSv2 required, no key pair, no port 22: shell access is via SSM
#     Session Manager (ssm / ssmmessages / ec2messages interface endpoints).
#   * EBS encrypted with the data CMK (key policy grants the Auto Scaling
#     service-linked role, kms.tf).
#   * No NAT. AL2023 dnf repos and the CodeDeploy agent installer come from
#     regional S3 through the S3 gateway endpoint; every other AWS API is
#     reached over PrivateLink (endpoints.tf).
#   * Non-secret config is written by user_data to /etc/tendrai/app.env and
#     loaded by the tendrai-app systemd unit (EnvironmentFile). Secrets are
#     NOT in user_data: the app reads DB_SECRET_ARN / APP_CONFIG_SECRET_ARN
#     from Secrets Manager at start-up with its instance role.
#   * Releases are installed in place by the CodeDeploy agent (cicd.tf)
#     into /opt/tendrai/app; its appspec hooks restart tendrai-app.
# ---------------------------------------------------------------------------

# Latest AL2023 AMI via the public SSM parameter. Overridable with var.ami_id
# (required on local emulators, which cannot resolve public AMI parameters).
data "aws_ssm_parameter" "al2023_ami" {
  count = var.ami_id == "" ? 1 : 0

  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  app_ami_id = var.ami_id != "" ? var.ami_id : data.aws_ssm_parameter.al2023_ami[0].value

  app_install_dir = "/opt/tendrai/app"
  app_log_file    = "/var/log/tendrai/app.log"

  # Non-secret runtime configuration of the API (api/src/config.ts).
  # Secret values never appear here: only secret ARNs, read at start-up.
  app_env = {
    NODE_ENV              = "production"
    PORT                  = tostring(var.app_port)
    AWS_REGION            = var.aws_region
    ENVIRONMENT           = var.environment
    DOCUMENTS_BUCKET      = aws_s3_bucket.documents.bucket
    UPLOADS_PREFIX        = local.s3_prefix_uploads
    DRAFTS_PREFIX         = local.s3_prefix_drafts
    JOB_QUEUE_URL         = aws_sqs_queue.jobs.url
    DB_HOST               = aws_db_instance.main.address
    DB_PORT               = tostring(aws_db_instance.main.port)
    DB_NAME               = var.db_name
    DB_SECRET_ARN         = aws_secretsmanager_secret.db_role["app"].arn
    DB_SSL_CA_PATH        = "${local.app_install_dir}/certs/rds-global-bundle.pem"
    APP_CONFIG_SECRET_ARN = aws_secretsmanager_secret.app_config.arn
    AUTH_MODE             = var.enable_cognito ? "alb" : "cognito"
    COGNITO_USER_POOL_ID  = var.enable_cognito ? aws_cognito_user_pool.main[0].id : ""
    COGNITO_CLIENT_ID     = var.enable_cognito ? aws_cognito_user_pool_client.alb[0].id : ""
    # pool signing keys bundled by CodeBuild (fetch:jwks); no runtime download
    COGNITO_JWKS_PATH = "${local.app_install_dir}/certs/cognito-jwks.json"
    CORS_ORIGIN       = var.enable_acm ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
    LOG_LEVEL         = "info"
  }

  # CloudWatch agent: ships the app log file to the app log group and
  # publishes memory/disk metrics in the project namespace (the instance
  # role's PutMetricData is conditioned on that namespace).
  cw_agent_config = {
    agent = {
      metrics_collection_interval = 60
      run_as_user                 = "cwagent"
    }
    logs = {
      logs_collected = {
        files = {
          collect_list = [
            {
              file_path       = local.app_log_file
              log_group_name  = aws_cloudwatch_log_group.app.name
              log_stream_name = "{instance_id}"
            },
          ]
        }
      }
    }
    metrics = {
      namespace = var.project_tag
      append_dimensions = {
        InstanceId = "$${aws:InstanceId}"
      }
      metrics_collected = {
        mem  = { measurement = ["mem_used_percent"] }
        disk = { measurement = ["used_percent"], resources = ["/"] }
      }
    }
  }

  app_user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # SSM agent is preinstalled on AL2023; make sure it is running.
    systemctl enable --now amazon-ssm-agent

    # Runtime packages from the AL2023 repos (regional S3, gateway endpoint).
    dnf install -y nodejs22 ruby amazon-cloudwatch-agent
    alternatives --set node /usr/bin/node-22 || true

    # Service account and directories for the app.
    id tendrai >/dev/null 2>&1 || useradd --system --home-dir /opt/tendrai --shell /sbin/nologin tendrai
    install -d -o tendrai -g tendrai -m 0755 /opt/tendrai ${local.app_install_dir}
    install -d -o tendrai -g tendrai -m 0750 /var/log/tendrai
    install -d -o root -g tendrai -m 0750 /etc/tendrai

    # Non-secret configuration (secret ARNs only; values are fetched at runtime).
    cat > /etc/tendrai/app.env <<'ENVFILE'
    ${join("\n", [for k, v in local.app_env : "${k}=${v}"])}
    ENVFILE
    chown root:tendrai /etc/tendrai/app.env
    chmod 0640 /etc/tendrai/app.env

    cat > /etc/systemd/system/tendrai-app.service <<'UNIT'
    [Unit]
    Description=TendrAI web application and API server
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=tendrai
    Group=tendrai
    WorkingDirectory=${local.app_install_dir}
    EnvironmentFile=/etc/tendrai/app.env
    ExecStart=/usr/bin/node dist/index.js
    Restart=on-failure
    RestartSec=5
    StandardOutput=append:${local.app_log_file}
    StandardError=append:${local.app_log_file}
    NoNewPrivileges=true
    PrivateTmp=true
    ProtectSystem=full
    ProtectHome=true

    [Install]
    WantedBy=multi-user.target
    UNIT
    systemctl daemon-reload
    # Enabled now, started by the CodeDeploy ApplicationStart hook once the
    # first release is installed in ${local.app_install_dir}.
    systemctl enable tendrai-app

    # CloudWatch agent (logs + metrics over the logs/monitoring endpoints).
    cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'CWCONF'
    ${jsonencode(local.cw_agent_config)}
    CWCONF
    usermod -a -G tendrai cwagent || true
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
      -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

    # CodeDeploy agent from the regional S3 bucket (gateway endpoint, no
    # internet egress). It polls CodeDeploy over the codedeploy and
    # codedeploy-commands-secure endpoints; no inbound connection is needed.
    cd /tmp
    aws s3 cp "s3://aws-codedeploy-${var.aws_region}/latest/install" ./codedeploy-install --region "${var.aws_region}"
    chmod +x ./codedeploy-install
    ./codedeploy-install auto
    grep -q '^:enable_auth_policy:' /etc/codedeploy-agent/conf/codedeployagent.yml \
      || echo ':enable_auth_policy: true' >> /etc/codedeploy-agent/conf/codedeployagent.yml
    systemctl enable codedeploy-agent
    systemctl restart codedeploy-agent
  EOF
}

resource "aws_launch_template" "app" {
  name_prefix   = "${local.name}-app-"
  image_id      = local.app_ami_id
  instance_type = var.instance_type

  # No key_name on purpose: access is via SSM Session Manager only.

  iam_instance_profile {
    arn = aws_iam_instance_profile.app.arn
  }

  vpc_security_group_ids = [aws_security_group.app.id]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = var.root_volume_size
      volume_type           = "gp3"
      encrypted             = true
      kms_key_id            = aws_kms_key.data.arn
      delete_on_termination = true
    }
  }

  monitoring {
    enabled = true
  }

  ebs_optimized = true

  user_data = base64encode(local.app_user_data)

  tag_specifications {
    resource_type = "instance"

    tags = {
      Name = "${local.name}-app"
    }
  }

  tag_specifications {
    resource_type = "volume"

    tags = {
      Name = "${local.name}-app"
    }
  }

  tags = {
    Name = "${local.name}-app"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "${local.name}-app-asg"
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity
  vpc_zone_identifier = aws_subnet.private[*].id

  target_group_arns         = [aws_lb_target_group.app.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 600

  enabled_metrics = [
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupMinSize",
    "GroupMaxSize",
    "GroupTotalInstances",
  ]

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  # A launch-template change (AMI, user_data, size) rolls the fleet.
  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 50
    }
  }

  tag {
    key                 = "Name"
    value               = "${local.name}-app"
    propagate_at_launch = true
  }

  # Default provider tags don't propagate to ASG-launched instances, so
  # replicate them here for cost allocation.
  tag {
    key                 = "Project"
    value               = var.project_tag
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  # Target tracking owns desired capacity after creation.
  lifecycle {
    ignore_changes = [desired_capacity]
  }

  depends_on = [
    aws_vpc_endpoint.interface,
    aws_vpc_endpoint.s3,
  ]
}

# ----- Auto scaling ----------------------------------------------------------

resource "aws_autoscaling_policy" "app_cpu" {
  name                   = "${local.name}-app-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    target_value = var.app_cpu_target_utilization

    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
  }
}
