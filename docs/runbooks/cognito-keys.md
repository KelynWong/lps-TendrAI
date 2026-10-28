# Runbook: Cognito signing keys rotated (sign-in fails)

## Purpose
Restore sign-in after Cognito starts signing tokens with a key that the running release does not know about.

## Background
Sign-in goes browser → ALB → Cognito sign-in page. The ALB then forwards the user's Cognito access token to the API. The API verifies it against the user pool's public signing keys in `certs/cognito-jwks.json`. CodeBuild bundles that file into every release (`npm --prefix api run fetch:jwks`), because the app instances have no internet access and Cognito user pools with a domain cannot be reached over PrivateLink. The API never downloads keys at runtime: a token signed with an unknown key gets a 401 (fail closed) and the log line `cognito_unknown_signing_key`.

## When to use
- The CloudWatch alarm `<name>-cognito-unknown-signing-key` fires, or
- every user gets "Invalid or expired session" right after signing in.

## Prerequisites
Permission to run the CodePipeline release (or to start the pipeline manually).

## Steps
1. Confirm the cause. In CloudWatch Logs Insights on the app log group `/<project>/<env>/app`:
   ```
   fields @timestamp, @message | filter @message like /cognito_unknown_signing_key/ | sort @timestamp desc | limit 20
   ```
2. Release again. The build fetches the current keys:
   ```powershell
   aws codepipeline start-pipeline-execution --name <pipeline_name output>
   ```
3. Wait for the CodeDeploy deployment to finish.

## Verification
- Sign in through the app URL.
- The alarm returns to OK within about 5 minutes.

## Rollback
Not applicable: the new release only refreshes public keys.

## Notes
- The keys are public. They are not secrets and need no protection.
- Sign-in is also refused when a user's email is already linked to a different Cognito user (message "This account is linked to a different sign-in"). That is not a key problem. An admin must clear `users.cognito_sub` for that row only if the Cognito user was deliberately recreated.
