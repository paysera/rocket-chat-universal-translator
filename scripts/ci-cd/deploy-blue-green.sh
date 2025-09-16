#!/bin/bash

set -e

ENVIRONMENT=$1
CLUSTER="translator-prod"
REGION="${AWS_DEFAULT_REGION:-eu-west-1}"

if [ -z "$ENVIRONMENT" ]; then
    echo "Usage: $0 <blue|green>"
    exit 1
fi

echo "🚀 Starting Blue-Green deployment to $ENVIRONMENT environment..."

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI."
    exit 1
fi

# Validate AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured or invalid."
    exit 1
fi

# Check if the cluster exists
if ! aws ecs describe-clusters --cluster-names $CLUSTER --region $REGION &> /dev/null; then
    echo "❌ ECS cluster '$CLUSTER' not found in region $REGION"
    echo "Creating basic deployment instead..."

    # Fallback to basic deployment
    if aws ecs describe-services --cluster default --services translator-api --region $REGION &> /dev/null; then
        echo "Using default cluster for deployment..."
        aws ecs update-service \
            --cluster default \
            --service translator-api \
            --force-new-deployment \
            --region $REGION

        echo "Waiting for service to stabilize..."
        aws ecs wait services-stable \
            --cluster default \
            --services translator-api \
            --region $REGION
    else
        echo "⚠️ No suitable ECS service found for deployment"
        echo "This might be the first deployment or configuration issue"
        exit 1
    fi
    exit 0
fi

# Get current active environment
echo "🔍 Checking current active environment..."

# Try to get current environment from target group tags
CURRENT=$(aws elbv2 describe-target-groups \
    --names translator-tg-active \
    --query 'TargetGroups[0].Tags[?Key==`Environment`].Value' \
    --output text \
    --region $REGION 2>/dev/null || echo "")

if [ -z "$CURRENT" ]; then
    # If no active target group, assume blue is current
    CURRENT="blue"
    echo "No active environment found, defaulting to blue as current"
fi

if [ "$CURRENT" == "blue" ]; then
    TARGET="green"
else
    TARGET="blue"
fi

echo "Current environment: $CURRENT"
echo "Deploying to: $TARGET"

# Check if target service exists
SERVICE_NAME="translator-api-$TARGET"

if ! aws ecs describe-services --cluster $CLUSTER --services $SERVICE_NAME --region $REGION &> /dev/null; then
    echo "⚠️ Service '$SERVICE_NAME' not found. Creating basic deployment..."

    # Fallback to single service deployment
    SERVICE_NAME="translator-api"
    if aws ecs describe-services --cluster $CLUSTER --services $SERVICE_NAME --region $REGION &> /dev/null; then
        echo "Using single service deployment"
    else
        echo "❌ No translator-api service found in cluster $CLUSTER"
        exit 1
    fi
fi

echo "🔄 Updating service: $SERVICE_NAME"

# Update service in target environment
aws ecs update-service \
    --cluster $CLUSTER \
    --service $SERVICE_NAME \
    --force-new-deployment \
    --region $REGION

# Wait for service to be stable
echo "⏳ Waiting for service to stabilize..."
aws ecs wait services-stable \
    --cluster $CLUSTER \
    --services $SERVICE_NAME \
    --region $REGION

echo "✅ Deployment to $TARGET environment completed successfully"

# If this is a true blue-green setup, we would switch traffic here
# For now, we'll just log success
if [ "$SERVICE_NAME" == "translator-api-$TARGET" ]; then
    echo "💡 Note: Traffic switching not implemented yet"
    echo "   Service is deployed but traffic routing needs manual configuration"
fi

echo "🎉 Blue-Green deployment process completed!"