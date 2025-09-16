# UŽDUOTIS #008: CI/CD Pipeline sukūrimas

## 🔴 PRIORITETAS: KRITINIS
**Terminas**: 3-4 dienos
**Laikas**: ~6-8 valandos
**Blokuoja**: Automated deployments, quality gates

## 📋 Problema

Nėra automated CI/CD pipeline:
- Manual deployment yra error-prone
- Testai nevykdomi automatiškai
- Nėra code quality gates
- Build artifacts nesaugomi
- Deployment history netrackinama

## 🎯 Kodėl tai kritiškai svarbu?

1. **Quality Assurance**: Be CI/CD galima deploy'inti broken code
2. **Deployment Speed**: Manual deployment užima valandas
3. **Rollback Capability**: Nėra automated rollback
4. **Audit Trail**: Nėra deployment history
5. **Team Productivity**: Developers praleidžia laiką manual tasks

## 🔧 Kaip taisyti

### Žingsnis 1: Sukurti GitHub Actions workflow

```yaml
mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'EOF'
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: '18'
  DOCKER_REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # Job 1: Code Quality Checks
  quality:
    name: Code Quality
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Check formatting
        run: npm run format:check

      - name: Security audit
        run: npm audit --audit-level=moderate

  # Job 2: Unit Tests
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: quality
    strategy:
      matrix:
        workspace: [api, plugin, shared]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests for ${{ matrix.workspace }}
        run: |
          cd ${{ matrix.workspace }}
          npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./${{ matrix.workspace }}/coverage/lcov.info
          flags: ${{ matrix.workspace }}
          name: ${{ matrix.workspace }}-coverage

  # Job 3: Integration Tests
  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    needs: quality
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: translator
          POSTGRES_PASSWORD: translator123
          POSTGRES_DB: translator_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run database migrations
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: translator_test
          DB_USER: translator
          DB_PASSWORD: translator123
        run: |
          cd api
          npm run migrate:test

      - name: Run integration tests
        env:
          DB_HOST: localhost
          REDIS_HOST: localhost
          NODE_ENV: test
        run: npm run test:integration

  # Job 4: E2E Tests
  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Start services with Docker Compose
        run: |
          cp .env.example .env.test
          docker-compose -f docker-compose.test.yml up -d
          sleep 30

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: |
            cypress/screenshots
            cypress/videos
            logs/

  # Job 5: Build Docker Images
  build:
    name: Build Docker Images
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.DOCKER_REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.DOCKER_REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix={{branch}}-

      - name: Build and push API image
        uses: docker/build-push-action@v5
        with:
          context: ./api
          push: true
          tags: ${{ steps.meta.outputs.tags }}-api
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push Plugin image
        uses: docker/build-push-action@v5
        with:
          context: ./plugin
          push: true
          tags: ${{ steps.meta.outputs.tags }}-plugin
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # Job 6: Security Scanning
  security:
    name: Security Scanning
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}-api
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

  # Job 7: Performance Tests
  performance:
    name: Performance Tests
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Start services
        run: |
          docker-compose -f docker-compose.test.yml up -d
          sleep 30

      - name: Run k6 performance tests
        uses: grafana/k6-action@v0.3.0
        with:
          filename: performance/api-load-test.js
          flags: --out html=performance-report.html

      - name: Upload performance report
        uses: actions/upload-artifact@v3
        with:
          name: performance-report
          path: performance-report.html

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('performance-report.html', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '## Performance Test Results\n' + report
            });
EOF
```

### Žingsnis 2: Sukurti CD workflow

```yaml
cat > .github/workflows/cd.yml << 'EOF'
name: CD Pipeline

on:
  push:
    branches: [main]
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

env:
  DOCKER_REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # Job 1: Deploy to Staging
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment:
      name: staging
      url: https://translate-api-staging.paysera.tech
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-west-1

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster translator-staging \
            --service translator-api \
            --force-new-deployment

      - name: Wait for deployment
        run: |
          aws ecs wait services-stable \
            --cluster translator-staging \
            --services translator-api

      - name: Run smoke tests
        run: |
          npm run test:smoke -- --url https://translate-api-staging.paysera.tech

      - name: Notify Slack
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'Staging deployment ${{ job.status }}'
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}

  # Job 2: Deploy to Production
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    environment:
      name: production
      url: https://translate-api.paysera.tech
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-west-1

      - name: Create deployment
        uses: bobheadxi/deployments@v1
        id: deployment
        with:
          step: start
          token: ${{ secrets.GITHUB_TOKEN }}
          env: production

      - name: Blue-Green Deployment
        run: |
          # Deploy to green environment
          ./scripts/deploy-blue-green.sh green

          # Run health checks
          ./scripts/health-check.sh https://translate-api-green.paysera.tech

          # Switch traffic
          ./scripts/switch-traffic.sh green

          # Wait and verify
          sleep 60
          ./scripts/verify-deployment.sh

      - name: Run smoke tests
        run: |
          npm run test:smoke -- --url https://translate-api.paysera.tech

      - name: Update deployment status
        uses: bobheadxi/deployments@v1
        if: always()
        with:
          step: finish
          token: ${{ secrets.GITHUB_TOKEN }}
          status: ${{ job.status }}
          env: production
          deployment_id: ${{ steps.deployment.outputs.deployment_id }}

      - name: Create release notes
        if: success()
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref }}
          release_name: Release ${{ github.ref }}
          body: |
            ## Changes
            ${{ github.event.head_commit.message }}

            ## Docker Images
            - API: `${{ env.DOCKER_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.ref }}-api`
            - Plugin: `${{ env.DOCKER_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.ref }}-plugin`

      - name: Notify team
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: |
            Production deployment ${{ job.status }}
            Version: ${{ github.ref }}
            Deployed by: ${{ github.actor }}
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}

  # Job 3: Rollback
  rollback:
    name: Rollback Production
    runs-on: ubuntu-latest
    if: failure() && github.ref == 'refs/heads/main'
    needs: deploy-production
    environment:
      name: production-rollback
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-west-1

      - name: Rollback deployment
        run: |
          # Get previous task definition
          PREVIOUS_TASK=$(aws ecs describe-services \
            --cluster translator-prod \
            --services translator-api \
            --query 'services[0].taskDefinition' \
            --output text)

          # Update service with previous version
          aws ecs update-service \
            --cluster translator-prod \
            --service translator-api \
            --task-definition $PREVIOUS_TASK

      - name: Notify emergency
        uses: 8398a7/action-slack@v3
        with:
          status: 'failure'
          text: '🚨 EMERGENCY: Production rollback initiated!'
          webhook_url: ${{ secrets.SLACK_WEBHOOK_EMERGENCY }}
EOF
```

### Žingsnis 3: Sukurti deployment scripts

```bash
mkdir -p scripts/ci-cd

cat > scripts/ci-cd/deploy-blue-green.sh << 'EOF'
#!/bin/bash

set -e

ENVIRONMENT=$1
CLUSTER="translator-prod"

echo "🚀 Starting Blue-Green deployment to $ENVIRONMENT..."

# Get current active environment
CURRENT=$(aws elbv2 describe-target-groups \
  --names translator-tg-active \
  --query 'TargetGroups[0].Tags[?Key==`Environment`].Value' \
  --output text)

if [ "$CURRENT" == "blue" ]; then
  TARGET="green"
else
  TARGET="blue"
fi

echo "Current: $CURRENT, Deploying to: $TARGET"

# Update service in target environment
aws ecs update-service \
  --cluster $CLUSTER \
  --service translator-api-$TARGET \
  --force-new-deployment

# Wait for service to be stable
echo "Waiting for service to stabilize..."
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services translator-api-$TARGET

echo "✅ Deployment to $TARGET complete"
EOF

chmod +x scripts/ci-cd/deploy-blue-green.sh
```

```bash
cat > scripts/ci-cd/health-check.sh << 'EOF'
#!/bin/bash

URL=$1
MAX_RETRIES=30
RETRY_INTERVAL=10

echo "🏥 Running health checks on $URL..."

for i in $(seq 1 $MAX_RETRIES); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" $URL/healthz)

  if [ "$STATUS" == "200" ]; then
    echo "✅ Health check passed"
    exit 0
  fi

  echo "Attempt $i/$MAX_RETRIES: Status $STATUS"
  sleep $RETRY_INTERVAL
done

echo "❌ Health check failed after $MAX_RETRIES attempts"
exit 1
EOF

chmod +x scripts/ci-cd/health-check.sh
```

```bash
cat > scripts/ci-cd/switch-traffic.sh << 'EOF'
#!/bin/bash

TARGET=$1
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names translator-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text)

echo "🔄 Switching traffic to $TARGET..."

# Update listener rule
aws elbv2 modify-listener \
  --listener-arn $ALB_ARN \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:region:account:targetgroup/translator-tg-$TARGET

# Tag new active environment
aws elbv2 add-tags \
  --resource-arns arn:aws:elasticloadbalancing:region:account:targetgroup/translator-tg-$TARGET \
  --tags Key=Environment,Value=$TARGET Key=Active,Value=true

echo "✅ Traffic switched to $TARGET"
EOF

chmod +x scripts/ci-cd/switch-traffic.sh
```

### Žingsnis 4: Sukurti GitLab CI alternatyvą

```yaml
cat > .gitlab-ci.yml << 'EOF'
stages:
  - build
  - test
  - security
  - deploy
  - rollback

variables:
  DOCKER_DRIVER: overlay2
  DOCKER_TLS_CERTDIR: ""
  CI_REGISTRY: registry.gitlab.com
  IMAGE_TAG: $CI_REGISTRY/$CI_PROJECT_PATH

# Templates
.docker:
  image: docker:latest
  services:
    - docker:dind
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY

# Build Stage
build:api:
  extends: .docker
  stage: build
  script:
    - docker build -t $IMAGE_TAG/api:$CI_COMMIT_SHA ./api
    - docker push $IMAGE_TAG/api:$CI_COMMIT_SHA
    - docker tag $IMAGE_TAG/api:$CI_COMMIT_SHA $IMAGE_TAG/api:latest
    - docker push $IMAGE_TAG/api:latest

build:plugin:
  extends: .docker
  stage: build
  script:
    - docker build -t $IMAGE_TAG/plugin:$CI_COMMIT_SHA ./plugin
    - docker push $IMAGE_TAG/plugin:$CI_COMMIT_SHA

# Test Stage
test:unit:
  stage: test
  image: node:18
  script:
    - npm ci
    - npm test
  coverage: '/Lines\s*:\s*(\d+\.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

test:integration:
  stage: test
  image: node:18
  services:
    - postgres:15
    - redis:7
  variables:
    POSTGRES_DB: translator_test
    POSTGRES_USER: translator
    POSTGRES_PASSWORD: translator123
    DB_HOST: postgres
    REDIS_HOST: redis
  script:
    - npm ci
    - npm run test:integration

test:e2e:
  stage: test
  image: cypress/base:18
  script:
    - npm ci
    - npm run test:e2e
  artifacts:
    when: on_failure
    paths:
      - cypress/screenshots
      - cypress/videos

# Security Stage
security:scan:
  stage: security
  image: aquasec/trivy
  script:
    - trivy image --severity HIGH,CRITICAL $IMAGE_TAG/api:$CI_COMMIT_SHA

security:sast:
  stage: security
  image: semgrep/semgrep
  script:
    - semgrep --config=auto .

# Deploy Stage
deploy:staging:
  stage: deploy
  image: alpine:latest
  environment:
    name: staging
    url: https://translate-api-staging.paysera.tech
  only:
    - develop
  before_script:
    - apk add --no-cache curl
  script:
    - curl -X POST $DEPLOY_WEBHOOK_STAGING

deploy:production:
  stage: deploy
  image: alpine:latest
  environment:
    name: production
    url: https://translate-api.paysera.tech
  only:
    - tags
  when: manual
  before_script:
    - apk add --no-cache curl
  script:
    - curl -X POST $DEPLOY_WEBHOOK_PRODUCTION

# Rollback Stage
rollback:production:
  stage: rollback
  image: alpine:latest
  environment:
    name: production
  when: manual
  only:
    - main
  script:
    - echo "Rolling back production..."
    - curl -X POST $ROLLBACK_WEBHOOK
EOF
```

### Žingsnis 5: Sukurti Jenkinsfile alternatyvą

```groovy
cat > Jenkinsfile << 'EOF'
pipeline {
  agent any

  environment {
    DOCKER_REGISTRY = 'ghcr.io'
    IMAGE_NAME = 'paysera/translator'
    SLACK_CHANNEL = '#translator-ci'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Quality Gates') {
      parallel {
        stage('Lint') {
          steps {
            sh 'npm run lint'
          }
        }
        stage('Type Check') {
          steps {
            sh 'npm run typecheck'
          }
        }
        stage('Security Audit') {
          steps {
            sh 'npm audit --audit-level=moderate'
          }
        }
      }
    }

    stage('Test') {
      parallel {
        stage('Unit Tests') {
          steps {
            sh 'npm test'
            publishHTML target: [
              allowMissing: false,
              alwaysLinkToLastBuild: true,
              keepAll: true,
              reportDir: 'coverage',
              reportFiles: 'index.html',
              reportName: 'Coverage Report'
            ]
          }
        }
        stage('Integration Tests') {
          steps {
            sh 'docker-compose -f docker-compose.test.yml up -d'
            sh 'npm run test:integration'
            sh 'docker-compose -f docker-compose.test.yml down'
          }
        }
      }
    }

    stage('Build') {
      steps {
        script {
          docker.build("${IMAGE_NAME}-api:${env.BUILD_NUMBER}", "./api")
          docker.build("${IMAGE_NAME}-plugin:${env.BUILD_NUMBER}", "./plugin")
        }
      }
    }

    stage('Push') {
      when {
        branch 'main'
      }
      steps {
        script {
          docker.withRegistry("https://${DOCKER_REGISTRY}", 'docker-credentials') {
            docker.image("${IMAGE_NAME}-api:${env.BUILD_NUMBER}").push()
            docker.image("${IMAGE_NAME}-api:${env.BUILD_NUMBER}").push('latest')
          }
        }
      }
    }

    stage('Deploy') {
      when {
        branch 'main'
      }
      steps {
        script {
          if (env.BRANCH_NAME == 'develop') {
            deploy('staging')
          } else if (env.BRANCH_NAME == 'main') {
            input message: 'Deploy to production?', ok: 'Deploy'
            deploy('production')
          }
        }
      }
    }
  }

  post {
    success {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: 'good',
        message: "Build #${env.BUILD_NUMBER} succeeded! :white_check_mark:"
      )
    }
    failure {
      slackSend(
        channel: env.SLACK_CHANNEL,
        color: 'danger',
        message: "Build #${env.BUILD_NUMBER} failed! :x:"
      )
    }
  }
}

def deploy(environment) {
  sh "kubectl set image deployment/translator-api translator-api=${IMAGE_NAME}-api:${env.BUILD_NUMBER} -n ${environment}"
  sh "kubectl rollout status deployment/translator-api -n ${environment}"
}
EOF
```

### Žingsnis 6: Sukurti pre-commit hooks

```yaml
cat > .pre-commit-config.yaml << 'EOF'
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-added-large-files
        args: ['--maxkb=1000']
      - id: check-merge-conflict

  - repo: https://github.com/pre-commit/mirrors-eslint
    rev: v8.36.0
    hooks:
      - id: eslint
        files: \.(js|jsx|ts|tsx)$
        args: ['--fix']

  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v2.7.1
    hooks:
      - id: prettier
        files: \.(js|jsx|ts|tsx|json|yaml|yml|md)$

  - repo: local
    hooks:
      - id: typecheck
        name: TypeScript Type Check
        entry: npm run typecheck
        language: system
        pass_filenames: false
        files: \.(ts|tsx)$

      - id: test
        name: Run Tests
        entry: npm test
        language: system
        pass_filenames: false
        files: \.(ts|tsx|js|jsx)$

      - id: security
        name: Security Audit
        entry: npm audit --audit-level=moderate
        language: system
        pass_filenames: false
EOF

# Install pre-commit
cat > scripts/setup-pre-commit.sh << 'EOF'
#!/bin/bash

echo "Setting up pre-commit hooks..."

# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Run on all files
pre-commit run --all-files

echo "✅ Pre-commit hooks installed"
EOF

chmod +x scripts/setup-pre-commit.sh
```

### Žingsnis 7: Sukurti release automation

```yaml
cat > .github/workflows/release.yml << 'EOF'
name: Release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g., 1.2.3)'
        required: true
      release_type:
        description: 'Release type'
        required: true
        default: 'patch'
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Configure Git
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"

      - name: Bump version
        run: |
          npm version ${{ github.event.inputs.release_type }} -m "chore: release v%s"
          VERSION=$(node -p "require('./package.json').version")
          echo "VERSION=$VERSION" >> $GITHUB_ENV

      - name: Generate changelog
        run: |
          npm run changelog
          git add CHANGELOG.md
          git commit -m "docs: update changelog for v${{ env.VERSION }}"

      - name: Create tag
        run: |
          git tag -a v${{ env.VERSION }} -m "Release v${{ env.VERSION }}"

      - name: Push changes
        run: |
          git push origin main
          git push origin v${{ env.VERSION }}

      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ env.VERSION }}
          release_name: Release v${{ env.VERSION }}
          body_path: CHANGELOG.md
          draft: false
          prerelease: false

      - name: Trigger deployment
        uses: actions/github-script@v6
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'cd.yml',
              ref: 'main',
              inputs: {
                environment: 'production',
                version: '${{ env.VERSION }}'
              }
            });
EOF
```

## ✅ Sėkmės kriterijai

- [ ] GitHub Actions workflows sukurti
- [ ] Visi testai vykdomi automatiškai
- [ ] Docker images buildina ir push'ina
- [ ] Security scanning veikia
- [ ] Deployment į staging automatic
- [ ] Deployment į production manual approval
- [ ] Rollback mechanizmas veikia
- [ ] Slack notifications configured

## ⚠️ Galimos problemos

1. **GitHub Actions minutes limit**: Free tier turi 2000 minutes/month
   - Sprendimas: Self-hosted runners arba paid plan

2. **Docker rate limits**: Docker Hub turi pull limits
   - Sprendimas: Use GitHub Container Registry (ghcr.io)

3. **Secrets management**: Sensitive data in workflows
   - Sprendimas: GitHub Secrets, Vault integration

4. **Flaky tests**: Random test failures
   - Sprendimas: Retry mechanism, test isolation

## 📚 Papildomi resursai

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Best Practices for CI/CD](https://docs.docker.com/develop/dev-best-practices/)
- [Blue-Green Deployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Sukonfigūruoti branch protection rules
2. Pridėti dependency updates automation (Dependabot)
3. Implementuoti canary deployments
4. Pridėti cost monitoring for CI/CD