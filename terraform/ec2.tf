# ---------------------------------------------------------------------------
# LPS-P2C — Application tier (item 5)
#
# Launch template + Auto Scaling group (min 1 / max 2) in the private
# subnets, Amazon Linux 2023.
#   * IMDSv2 required, no key pair, no port 22 — shell access is via SSM
#     Session Manager (ssm/ssmmessages/ec2messages interface endpoints).
#   * EBS encrypted with the data CMK.
#   * AL2023 dnf repos and the CodeDeploy agent installer are served from
#     regional S3, reachable through the S3 gateway endpoint (no NAT needed).
# ---------------------------------------------------------------------------

# Latest AL2023 AMI via the public SSM parameter. Overridable with var.ami_id
# (required on local emulators, which cannot resolve public AMI parameters).
data "aws_ssm_parameter" "al2023_ami" {
  count = var.ami_id == "" ? 1 : 0

  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  app_ami_id = var.ami_id != "" ? var.ami_id : data.aws_ssm_parameter.al2023_ami[0].value

  app_user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # SSM agent is preinstalled on AL2023; just make sure it is running.
    systemctl enable --now amazon-ssm-agent

    # Install the CodeDeploy agent from the regional S3 bucket (reached via
    # the S3 gateway endpoint — no internet egress required).
    dnf install -y ruby wget || dnf install -y ruby
    cd /tmp
    aws s3 cp "s3://aws-codedeploy-${var.aws_region}/latest/install" ./codedeploy-install --region "${var.aws_region}" || true
    if [ -f ./codedeploy-install ]; then
      chmod +x ./codedeploy-install
      ./codedeploy-install auto || true
    fi
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
    instance_metadata_tags      = "enabled"
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
  health_check_grace_period = 300

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

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
  # replicate them here for CodeDeploy targeting / cost allocation.
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

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
