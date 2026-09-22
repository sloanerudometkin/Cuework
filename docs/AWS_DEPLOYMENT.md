# Deploying Cuework to AWS

**Path:** Docker image → Amazon ECR → **AWS App Runner** (HTTPS, autoscaling, no servers to manage) → **Amazon RDS for PostgreSQL**, with secrets in **AWS Secrets Manager**.

> **Status.** These steps were written against the container that was built and run locally (against PostgreSQL 16), but they have **not been executed against a live AWS account** — no AWS credentials were available while building. Treat the CLI snippets as a careful runbook, check each command's output, and expect to adjust names/regions. Costs are rough: budget on the order of **$50–90/month** for a `db.t4g.micro` RDS instance plus one small App Runner service; confirm in the AWS Pricing Calculator.

## Why this path

* **One container, no queues or workers** — matches the architecture (a single Next.js server with a PostgreSQL database).
* **App Runner** gives managed TLS, health checks, deploys and scaling with far less to operate than ECS/EKS.
* **RDS** for durable, backed-up PostgreSQL. (The embedded database used for local demos is *not* for production: the container filesystem is ephemeral.)
* Amplify Hosting was rejected because its SSR compute can't easily reach a private RDS instance.

## 0. Variables

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export APP=cuework
export ECR_REPO=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$APP
```

## 1. Container registry and image

```bash
aws ecr create-repository --repository-name $APP --image-scanning-configuration scanOnPush=true
aws ecr get-login-password | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# App Runner runs linux/amd64. On Apple Silicon you MUST specify the platform:
docker buildx build --platform linux/amd64 -t $ECR_REPO:1 --push .
```

## 2. Network and database

Use your default VPC for a first deploy, or a dedicated one. You need **two private/isolated subnets in different AZs** for RDS and the App Runner VPC connector.

```bash
# Security groups: one for the App Runner connector, one for RDS that only accepts the connector.
export VPC_ID=<your-vpc-id>
export APPRUNNER_SG=$(aws ec2 create-security-group --group-name cuework-apprunner --description "Cuework App Runner egress" --vpc-id $VPC_ID --query GroupId --output text)
export RDS_SG=$(aws ec2 create-security-group --group-name cuework-rds --description "Cuework RDS" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG --protocol tcp --port 5432 --source-group $APPRUNNER_SG

aws rds create-db-subnet-group --db-subnet-group-name cuework --db-subnet-group-description "Cuework" --subnet-ids <subnet-a> <subnet-b>

# A URL-safe password (hex) avoids escaping problems inside DATABASE_URL.
export DB_PASSWORD=$(openssl rand -hex 24)
aws rds create-db-instance \
  --db-instance-identifier cuework-db --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro --allocated-storage 20 --storage-type gp3 --storage-encrypted \
  --master-username cuework_admin --master-user-password "$DB_PASSWORD" --db-name cuework \
  --db-subnet-group-name cuework --vpc-security-group-ids $RDS_SG \
  --no-publicly-accessible --backup-retention-period 7 --deletion-protection
aws rds wait db-instance-available --db-instance-identifier cuework-db
export DB_HOST=$(aws rds describe-db-instances --db-instance-identifier cuework-db --query 'DBInstances[0].Endpoint.Address' --output text)
```

## 3. Secrets

Store each value as its **own plain-string secret** (this avoids JSON-key ARN syntax):

```bash
aws secretsmanager create-secret --name cuework/prod/session-secret --secret-string "$(openssl rand -base64 48)"
aws secretsmanager create-secret --name cuework/prod/database-url \
  --secret-string "postgresql://cuework_admin:$DB_PASSWORD@$DB_HOST:5432/cuework"
aws secretsmanager create-secret --name cuework/prod/server-actions-key --secret-string "$(openssl rand -base64 32)"
```

> A dedicated, least-privilege database role is better than the master user for the long term; create one with `psql` from a bastion/SSM session and update the `database-url` secret.

## 4. IAM roles

```bash
# Lets App Runner pull from ECR
aws iam create-role --role-name cuework-apprunner-access --assume-role-policy-document '{
  "Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name cuework-apprunner-access \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# Lets the running service read its secrets
aws iam create-role --role-name cuework-apprunner-instance --assume-role-policy-document '{
  "Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name cuework-apprunner-instance --policy-name read-cuework-secrets --policy-document '{
  "Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],
  "Resource":"arn:aws:secretsmanager:'$AWS_REGION':'$AWS_ACCOUNT_ID':secret:cuework/prod/*"}]}'
```

## 5. Create the service

```bash
export VPC_CONNECTOR_ARN=$(aws apprunner create-vpc-connector --vpc-connector-name cuework \
  --subnets <subnet-a> <subnet-b> --security-groups $APPRUNNER_SG --query VpcConnector.VpcConnectorArn --output text)

SECRET_ARN() { aws secretsmanager describe-secret --secret-id "$1" --query ARN --output text; }

aws apprunner create-service --service-name $APP --cli-input-json '{
  "SourceConfiguration": {
    "AuthenticationConfiguration": {"AccessRoleArn": "arn:aws:iam::'$AWS_ACCOUNT_ID':role/cuework-apprunner-access"},
    "AutoDeploymentsEnabled": false,
    "ImageRepository": {
      "ImageIdentifier": "'$ECR_REPO':1",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "DATABASE_SSL": "verify",
          "DEMO_MODE": "false"
        },
        "RuntimeEnvironmentSecrets": {
          "SESSION_SECRET": "'$(SECRET_ARN cuework/prod/session-secret)'",
          "DATABASE_URL": "'$(SECRET_ARN cuework/prod/database-url)'",
          "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY": "'$(SECRET_ARN cuework/prod/server-actions-key)'"
        }
      }
    }
  },
  "InstanceConfiguration": {"Cpu": "1 vCPU", "Memory": "2 GB",
    "InstanceRoleArn": "arn:aws:iam::'$AWS_ACCOUNT_ID':role/cuework-apprunner-instance"},
  "NetworkConfiguration": {"EgressConfiguration": {"EgressType": "VPC", "VpcConnectorArn": "'$VPC_CONNECTOR_ARN'"}},
  "HealthCheckConfiguration": {"Protocol": "HTTP", "Path": "/api/health", "Interval": 10, "Timeout": 5,
    "HealthyThreshold": 1, "UnhealthyThreshold": 5}
}'
```

* **First boot applies migrations automatically** (idempotent). Keep the first deploy at a single instance (App Runner's default minimum is 1) so two instances don't race to migrate; the auto-scaling maximum can be raised afterwards.
* `DATABASE_SSL=verify` uses the AWS RDS CA bundle already baked into the image (`/app/certs/rds-global-bundle.pem`) — encrypted **and** verified.
* `DEMO_MODE=false` means only credential sign-in is offered. Set it to `true` only on a separate, disposable demo instance: the demo workspace is shared and passwordless.

Then open the service URL from `aws apprunner describe-service --service-arn <arn> --query Service.ServiceUrl`, click **Create a workspace**, and you have a real, empty Starter workspace.

## 6. Custom domain, WAF, monitoring

```bash
aws apprunner associate-custom-domain --service-arn <arn> --domain-name app.example.com
```

* Add the CNAME/validation records it returns.
* **AWS WAF** can be associated with the App Runner service to rate-limit `/login` and `/signup` across instances (the in-app login throttle is per instance).
* Logs go to CloudWatch automatically. Alarm on the App Runner `5xxStatusResponses` and RDS `CPUUtilization` / `FreeStorageSpace` metrics.

## 7. Releasing an update

```bash
docker buildx build --platform linux/amd64 -t $ECR_REPO:2 --push .
aws apprunner update-service --service-arn <arn> --source-configuration '{
  "ImageRepository": {"ImageIdentifier":"'$ECR_REPO':2","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"3000"}}}'
```

(Re-pass the `AuthenticationConfiguration` if the CLI asks for it.) Migrations for the new version run on boot. Schema changes should be additive and backward-compatible so an old instance keeps working during a rolling deploy.

## Backups and data

* RDS automated backups are on (7 days). Take a manual snapshot before risky releases: `aws rds create-db-snapshot --db-instance-identifier cuework-db --db-snapshot-identifier pre-release-1`.
* Deletion protection is enabled; disable it deliberately when tearing down.

## Teardown

```bash
aws apprunner delete-service --service-arn <arn>
aws rds modify-db-instance --db-instance-identifier cuework-db --no-deletion-protection
aws rds delete-db-instance --db-instance-identifier cuework-db --final-db-snapshot-identifier cuework-final
```

## Checklist before real customer data

- [ ] `DEMO_MODE=false`, `DATABASE_SSL=verify`, `SESSION_SECRET` set from Secrets Manager
- [ ] Database user is least-privilege, not the master user
- [ ] WAF rate limit on `/login` and `/signup`
- [ ] Custom domain with HTTPS; HSTS at the edge
- [ ] Alarms on 5xx and RDS storage/CPU; RDS backup restore tested
- [ ] Password reset and email verification added (not in this MVP)
