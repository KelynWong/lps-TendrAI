# ---------------------------------------------------------------------------
# TendrAI - full fresh-start cycle against Floci:
#   destroy -> wipe emulator -> start clean -> remove default VPC ->
#   apply -> re-pin the UI console to ap-southeast-1
#
#   .\reset-floci.ps1               # full cycle
#   .\reset-floci.ps1 -SkipDestroy  # emulator already gone/broken; just rebuild
# ---------------------------------------------------------------------------
param([switch]$SkipDestroy)

Set-Location $PSScriptRoot
$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION = "ap-southeast-1"

$aws = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $aws) { $aws = Join-Path $env:ProgramFiles "Amazon\AWSCLIV2\aws.exe" }
$tf = (Get-Command terraform -ErrorAction SilentlyContinue).Source
if (-not $tf) {
    # winget install location fallback (PATH only refreshes in new terminals)
    $tf = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Hashicorp.Terraform*" -Recurse -Filter terraform.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $tf) { Write-Host "terraform not found - winget install HashiCorp.Terraform" -ForegroundColor Red; exit 1 }
$ep = "--endpoint-url", "http://localhost:4566"

function Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Magenta }

# 1. Terraform destroy (best effort - emulator state is wiped anyway in step 2)
if (-not $SkipDestroy) {
    Step "terraform destroy"
    & $tf destroy '-auto-approve' '-var-file=common.tfvars' '-var-file=floci.tfvars'
}

# 2. Stop the emulator, wipe its data volume, remove spawned sidecars
#    (floci-ui, floci-ec2-*, floci-rds-* are created by the main container,
#    so `compose down` alone does not remove them)
Step "wiping emulator containers and state"
docker compose -f docker-compose.floci.yml down -v --remove-orphans 2>$null
docker ps -aq --filter "name=floci" | ForEach-Object { docker rm -f $_ } | Out-Null
# Emulator state is gone -> the local tfstate would be stale; start clean.
Remove-Item terraform.tfstate, terraform.tfstate.backup -ErrorAction SilentlyContinue

# 3. Fresh emulator
Step "starting Floci"
docker compose -f docker-compose.floci.yml up -d
$deadline = (Get-Date).AddMinutes(3)
$ok = $false
do {
    Start-Sleep -Seconds 3
    & $aws @ep sts get-caller-identity *> $null
    $ok = ($LASTEXITCODE -eq 0)
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) { Write-Host "Floci did not become ready within 3 minutes" -ForegroundColor Red; exit 1 }
Write-Host "Floci is up."

# 4. Remove the auto-created default VPC in ap-southeast-1 (cosmetic - keeps
#    the console showing only TendrAI resources). Recreated on every fresh
#    start, which is why this lives here.
Step "removing default VPC"
$subnets = (& $aws @ep ec2 describe-subnets --filters Name=vpc-id,Values=vpc-default-ap-southeast-1 --query "Subnets[].SubnetId" --output text) -split "\s+"
foreach ($s in $subnets) { if ($s) { & $aws @ep ec2 delete-subnet --subnet-id $s *> $null } }
& $aws @ep ec2 delete-vpc --vpc-id vpc-default-ap-southeast-1 *> $null

# 5. Build everything from scratch
Step "terraform init + apply"
& $tf init '-input=false' | Select-Object -Last 1
& $tf apply '-auto-approve' '-var-file=common.tfvars' '-var-file=floci.tfvars'
if ($LASTEXITCODE -ne 0) { Write-Host "apply failed - see errors above" -ForegroundColor Red; exit 1 }

# 6. Re-pin the web console to ap-southeast-1 (the main container spawns the
#    floci-ui sidecar hardcoded to us-east-1 - the "known quirk")
Step "re-pinning Floci UI console to ap-southeast-1"
docker rm -f floci-ui *> $null
$ip = docker inspect lps-p2c-floci --format '{{(index .NetworkSettings.Networks \"terraform_default\").IPAddress}}'
docker run -d --name floci-ui --network terraform_default -p 4500:4500 `
    -e AWS_DEFAULT_REGION=ap-southeast-1 -e AWS_REGION=ap-southeast-1 `
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_SESSION_TOKEN=test `
    -e FLOCI_HOSTNAME=$ip -e FLOCI_ENDPOINT=http://${ip}:4566 -e AWS_ENDPOINT_URL=http://${ip}:4566 `
    -e PORT=4500 -e FLOCI_CLOUD=aws `
    floci/floci-ui:latest | Out-Null

Write-Host ""
Write-Host "Fresh environment ready." -ForegroundColor Green
Write-Host "  Console:   http://localhost:4500/console/aws  (region ap-southeast-1)"
Write-Host "  Inventory: .\floci-inventory.ps1"
exit 0
