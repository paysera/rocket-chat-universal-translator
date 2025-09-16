# 🚀 CI/CD Pipeline Setup - Universal Translator

## Overview

This document provides a comprehensive guide for the CI/CD pipeline implementation for the Universal Translator project. The pipeline includes automated testing, security scanning, Docker image building, and deployment automation.

## 📁 Files Created

### GitHub Actions Workflows
- `.github/workflows/ci.yml` - Continuous Integration pipeline
- `.github/workflows/cd.yml` - Continuous Deployment pipeline
- `.github/workflows/release.yml` - Release automation workflow

### Deployment Scripts
- `scripts/ci-cd/deploy-blue-green.sh` - Blue-green deployment script
- `scripts/ci-cd/health-check.sh` - Comprehensive health checking
- `scripts/ci-cd/switch-traffic.sh` - Traffic switching for blue-green
- `scripts/ci-cd/verify-deployment.sh` - Deployment verification
- `scripts/ci-cd/run-tests.sh` - Unified test runner script

### Pre-commit Configuration
- `.pre-commit-config.yaml` - Pre-commit hooks configuration
- `scripts/setup-pre-commit.sh` - Pre-commit setup script

### Testing Infrastructure
- `docker-compose.test.yml` - Testing environment configuration
- `performance/api-load-test.js` - K6 load testing script

## 🔄 CI/CD Pipeline Flow

### Continuous Integration (CI)

1. **Code Quality Checks**
   - ESLint linting
   - TypeScript type checking
   - Prettier formatting validation
   - Security audit (npm audit)

2. **Testing Strategy**
   - **Unit Tests**: Individual component testing
   - **Integration Tests**: Database and Redis integration
   - **E2E Tests**: Full application workflow testing
   - **Performance Tests**: Load testing with K6

3. **Docker Image Building**
   - Multi-stage Docker builds
   - Image caching optimization
   - Security scanning with Trivy
   - Push to GitHub Container Registry

4. **Security Scanning**
   - Dependency vulnerability scanning
   - Code security analysis with Snyk
   - Container image security scanning

### Continuous Deployment (CD)

1. **Staging Deployment**
   - Automatic deployment on `develop` branch
   - Health checks and smoke tests
   - Slack notifications

2. **Production Deployment**
   - Manual approval required
   - Blue-green deployment strategy
   - Comprehensive health verification
   - Automatic rollback on failure

3. **Release Management**
   - Automated release creation
   - Version bumping
   - Changelog generation
   - Docker image tagging

## 🛠️ Setup Instructions

### 1. GitHub Repository Setup

```bash
# Enable GitHub Actions in your repository settings
# Configure the following secrets in GitHub:

# Required secrets:
SLACK_WEBHOOK                    # Slack webhook for notifications
SLACK_WEBHOOK_EMERGENCY         # Emergency Slack webhook

# Deployment secrets (choose based on your infrastructure):
AWS_ACCESS_KEY_ID               # AWS credentials for ECS deployment
AWS_SECRET_ACCESS_KEY
KUBE_CONFIG_DATA               # Kubernetes config (base64 encoded)
STAGING_SSH_HOST               # SSH deployment host
STAGING_SSH_USER               # SSH user
STAGING_SSH_KEY                # SSH private key
PRODUCTION_URL                 # Production URL for health checks
STAGING_URL                    # Staging URL for health checks

# Optional secrets:
SNYK_TOKEN                     # Snyk security scanning
```

### 2. Pre-commit Hooks Setup

```bash
# Run the setup script
./scripts/setup-pre-commit.sh

# Or manually install pre-commit
pip install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

### 3. Docker Environment

```bash
# Test the CI/CD pipeline locally
docker-compose -f docker-compose.test.yml up --build

# Run specific test suites
npm run test:ci          # CI test suite
npm run test:integration # Integration tests
npm run test:e2e        # End-to-end tests
npm run test:performance # Performance tests
```

## 🎯 Available Scripts

### Testing Scripts
```bash
npm run test            # Unit tests only
npm run test:ci         # CI test suite (lint, type, unit, security)
npm run test:integration # Integration tests with DB/Redis
npm run test:e2e        # End-to-end tests
npm run test:performance # Load testing with K6
npm run test:security   # Security scans
npm run test:full       # Complete test suite
```

### Development Scripts
```bash
npm run lint            # Lint all workspaces
npm run lint:fix        # Fix linting issues
npm run typecheck       # TypeScript type checking
npm run format          # Format code with Prettier
npm run format:check    # Check formatting
```

### Docker Scripts
```bash
npm run docker:test     # Start test environment
npm run docker:dev      # Start development environment
npm run docker:prod     # Start production environment
```

### Utility Scripts
```bash
npm run clean           # Clean all node_modules
npm run clean:dist      # Clean build directories
npm run setup:ci        # Setup CI environment
```

## 🏗️ Infrastructure Requirements

### Minimum Requirements
- **GitHub Actions**: 2000 minutes/month (free tier)
- **Docker Registry**: GitHub Container Registry (free)
- **Node.js**: Version 18+
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7+

### Deployment Options

#### Option 1: AWS ECS
- ECS Cluster with Fargate
- Application Load Balancer
- Target Groups for blue-green deployment
- RDS PostgreSQL and ElastiCache Redis

#### Option 2: Kubernetes
- Kubernetes cluster (EKS, GKE, AKS)
- Ingress controller
- Persistent volumes for data
- ConfigMaps and Secrets

#### Option 3: Docker Compose
- Single server deployment
- Docker and Docker Compose installed
- Reverse proxy (nginx/traefik)
- SSL certificates

## 📊 Monitoring and Observability

### Metrics Tracked
- **Build Success Rate**: Percentage of successful builds
- **Test Coverage**: Code coverage across all workspaces
- **Deployment Frequency**: How often deployments occur
- **Mean Time to Recovery**: Time to recover from failures
- **Error Rates**: Application and infrastructure errors

### Health Checks
- Application startup health
- Database connectivity
- Redis cache connectivity
- API endpoint responsiveness
- Translation service functionality

## 🔒 Security Measures

### Code Security
- Pre-commit security hooks
- Dependency vulnerability scanning
- Static code analysis
- Secret detection and prevention

### Infrastructure Security
- Container image scanning
- Least privilege access policies
- Encrypted secrets management
- Network security groups

### Deployment Security
- Signed commits requirement
- Branch protection rules
- Required status checks
- Manual approval for production

## 📈 Performance Optimization

### Build Optimization
- Docker layer caching
- npm package caching
- Parallel job execution
- Conditional job execution

### Test Optimization
- Test parallelization
- Smart test selection
- Incremental testing
- Test result caching

### Deployment Optimization
- Blue-green deployments
- Health check automation
- Rollback automation
- Progressive rollouts

## 🚨 Troubleshooting

### Common Issues

#### 1. GitHub Actions Failures
```bash
# Check logs in GitHub Actions tab
# Common fixes:
- Verify secrets are properly configured
- Check Docker image builds locally
- Ensure all tests pass locally
```

#### 2. Pre-commit Hook Failures
```bash
# Fix formatting issues
npm run format

# Fix linting issues
npm run lint:fix

# Skip hooks in emergency (not recommended)
git commit --no-verify
```

#### 3. Docker Build Failures
```bash
# Test Docker builds locally
docker build -t test-image ./api
docker build -t test-image ./plugin

# Clean Docker cache
docker system prune -a
```

#### 4. Test Failures
```bash
# Run specific test types
./scripts/ci-cd/run-tests.sh unit
./scripts/ci-cd/run-tests.sh integration

# Debug with verbose output
./scripts/ci-cd/run-tests.sh unit test true
```

## 🔄 Workflow Examples

### Feature Development Workflow
1. Create feature branch from `develop`
2. Implement changes with tests
3. Pre-commit hooks run automatically
4. Push triggers CI pipeline
5. Create PR to `develop`
6. CI runs full test suite
7. Code review and approval
8. Merge triggers staging deployment

### Release Workflow
1. Create release PR from `develop` to `main`
2. Update version and changelog
3. Merge to `main` triggers production pipeline
4. Manual approval required for production
5. Blue-green deployment to production
6. Health checks and verification
7. Release notes generated automatically

### Hotfix Workflow
1. Create hotfix branch from `main`
2. Implement critical fix
3. Fast-track testing
4. Direct merge to `main`
5. Emergency production deployment
6. Cherry-pick to `develop`

## 🎯 Success Metrics

### Pipeline Health
- ✅ Build success rate > 95%
- ✅ Test coverage > 80%
- ✅ Security scan pass rate > 95%
- ✅ Deployment success rate > 99%

### Performance Targets
- ✅ CI pipeline < 10 minutes
- ✅ Deployment time < 5 minutes
- ✅ Rollback time < 2 minutes
- ✅ Zero-downtime deployments

### Quality Gates
- ✅ All tests must pass
- ✅ No high-severity security issues
- ✅ Code coverage maintained
- ✅ Performance benchmarks met

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Blue-Green Deployment Guide](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [K6 Load Testing](https://k6.io/docs/)
- [Pre-commit Hooks](https://pre-commit.com/)

## 🤝 Contributing

When contributing to this project:
1. Follow conventional commit messages
2. Ensure all pre-commit hooks pass
3. Add tests for new features
4. Update documentation as needed
5. Monitor CI/CD pipeline status

## 🆘 Support

For CI/CD pipeline issues:
1. Check GitHub Actions logs
2. Review this documentation
3. Contact the DevOps team
4. Create issue in the repository

---

**Last Updated**: September 2024
**Version**: 1.0.0
**Status**: ✅ Production Ready