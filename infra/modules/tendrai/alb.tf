# ---------------------------------------------------------------------------
# TendrAI — Application Load Balancer (diagram items 1, 2, 3, 23)
#
# The ALB is the only public-facing component. One instance target group
# backs the EC2 Auto Scaling group (instances are registered by the ASG;
# CodeDeploy deregisters/re-registers each instance during an in-place
# deployment). Listener layout depends on the feature flags:
#   * enable_acm = true  -> HTTPS :443 listener (TLS 1.3 policy) serving the
#                           app; HTTP :80 only redirects to HTTPS.
#     - enable_cognito = true -> authenticate-cognito action runs before the
#       forward on the HTTPS listener.
#   * enable_acm = false -> plain HTTP :80 listener forwarding to the app
#     (local emulator / early bring-up only).
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  drop_invalid_header_fields = true

  tags = {
    Name = "${local.name}-alb"
  }
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name}-app"
  port        = var.app_port
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name}-app"
  }
}

# ----- HTTPS listener (enable_acm = true) ------------------------------------

resource "aws_lb_listener" "https" {
  count = var.enable_acm ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  # Authenticate against Cognito first (when enabled), then forward.
  dynamic "default_action" {
    for_each = var.enable_cognito ? [1] : []

    content {
      type  = "authenticate-cognito"
      order = 1

      authenticate_cognito {
        user_pool_arn       = aws_cognito_user_pool.main[0].arn
        user_pool_client_id = aws_cognito_user_pool_client.alb[0].id
        user_pool_domain    = aws_cognito_user_pool_domain.main[0].domain
        scope               = "openid email profile"

        on_unauthenticated_request = "authenticate"
        session_timeout            = 28800
      }
    }
  }

  default_action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# ----- HTTP :80 --------------------------------------------------------------

# With ACM: permanent redirect to HTTPS.
resource "aws_lb_listener" "http_redirect" {
  count = var.enable_acm ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Without ACM (local emulator / bring-up): plain HTTP forward, no auth.
resource "aws_lb_listener" "http_forward" {
  count = var.enable_acm ? 0 : 1

  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
