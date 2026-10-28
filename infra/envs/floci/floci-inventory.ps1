# ---------------------------------------------------------------------------
# TendrAI - Floci resource inventory
#
# CLI inventory of everything in the emulator (complements the Floci web UI
# at http://localhost:4500/console/aws - served by the floci-ui sidecar).
#   .\floci-inventory.ps1
# ---------------------------------------------------------------------------

$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION = "ap-southeast-1"
# Resolve aws.exe even in shells opened before the CLI was installed (PATH not refreshed)
$aws = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $aws) { $aws = Join-Path $env:ProgramFiles "Amazon\AWSCLIV2\aws.exe" }
if (-not (Test-Path $aws)) { Write-Host "AWS CLI not found - winget install Amazon.AWSCLI" -ForegroundColor Red; exit 1 }
$ep = "--endpoint-url", "http://localhost:4566"

function Section($title, $scriptblock) {
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Magenta
    try { & $scriptblock } catch { Write-Host "  (error: $_)" -ForegroundColor DarkYellow }
}

Section "Health" { & $aws @ep sts get-caller-identity --query "Account" --output text }

Section "S3 buckets" { & $aws @ep s3 ls }

Section "VPCs" {
    & $aws @ep ec2 describe-vpcs --query "Vpcs[].[VpcId,CidrBlock,Tags[?Key=='Name']|[0].Value]" --output table
}

Section "Subnets" {
    & $aws @ep ec2 describe-subnets --query "Subnets[].[SubnetId,CidrBlock,AvailabilityZone,Tags[?Key=='Name']|[0].Value]" --output table
}

Section "Security groups" {
    & $aws @ep ec2 describe-security-groups --query "SecurityGroups[].[GroupId,GroupName]" --output table
}

Section "VPC endpoints" {
    & $aws @ep ec2 describe-vpc-endpoints --query "VpcEndpoints[].[VpcEndpointId,ServiceName]" --output table
}

Section "Load balancers" {
    & $aws @ep elbv2 describe-load-balancers --query "LoadBalancers[].[LoadBalancerName,DNSName,Scheme]" --output table
}

Section "Target groups" {
    & $aws @ep elbv2 describe-target-groups --query "TargetGroups[].[TargetGroupName,Port,Protocol]" --output table
}

Section "EC2 launch templates / Auto Scaling groups" {
    & $aws @ep ec2 describe-launch-templates --query "LaunchTemplates[].[LaunchTemplateName,LatestVersionNumber]" --output table
    & $aws @ep autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,MinSize,MaxSize,DesiredCapacity]" --output table
}

Section "Lambda functions" {
    & $aws @ep lambda list-functions --query "Functions[].[FunctionName,Runtime,MemorySize,Timeout]" --output table
}

Section "SQS queues" {
    & $aws @ep sqs list-queues --query "QueueUrls" --output table
}

Section "Step Functions state machines" {
    & $aws @ep stepfunctions list-state-machines --query "stateMachines[].[name,type]" --output table
}

Section "RDS instances" {
    & $aws @ep rds describe-db-instances --query "DBInstances[].[DBInstanceIdentifier,Engine,DBInstanceClass,DBInstanceStatus]" --output table
}

Section "Cognito user pools" {
    & $aws @ep cognito-idp list-user-pools --max-results 20 --query "UserPools[].[Id,Name]" --output table
}

Section "KMS keys" {
    & $aws @ep kms list-aliases --query "Aliases[?starts_with(AliasName,'alias/tendrai')].[AliasName,TargetKeyId]" --output table
}

Section "Secrets" {
    & $aws @ep secretsmanager list-secrets --query "SecretList[].Name" --output table
}

Section "CloudWatch log groups" {
    & $aws @ep logs describe-log-groups --query "logGroups[].logGroupName" --output table
}

Section "CloudWatch alarms" {
    & $aws @ep cloudwatch describe-alarms --query "MetricAlarms[].[AlarmName,StateValue]" --output table
}

Section "WAF Web ACLs" {
    & $aws @ep wafv2 list-web-acls --scope REGIONAL --query "WebACLs[].Name" --output table
}

Section "ACM certificates" {
    & $aws @ep acm list-certificates --query "CertificateSummaryList[].[DomainName,Status]" --output table
}

Write-Host ""
Write-Host "Done. Tip: pipe a section's query through 'aws @ep <svc> <op> help' to explore further." -ForegroundColor DarkGray

exit 0
