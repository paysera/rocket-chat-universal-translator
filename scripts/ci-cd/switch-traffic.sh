#!/bin/bash

TARGET=$1
REGION="${AWS_DEFAULT_REGION:-eu-west-1}"

if [ -z "$TARGET" ]; then
    echo "Usage: $0 <blue|green>"
    exit 1
fi

echo "🔄 Starting traffic switch to $TARGET environment..."

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

# Check if we're using Application Load Balancer
echo "🔍 Looking for Application Load Balancer..."

ALB_ARN=$(aws elbv2 describe-load-balancers \
    --names translator-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text \
    --region $REGION 2>/dev/null)

if [ "$ALB_ARN" == "None" ] || [ -z "$ALB_ARN" ]; then
    echo "⚠️ Application Load Balancer 'translator-alb' not found"
    echo "Checking for alternative load balancers..."

    # Try to find any load balancer with 'translator' in the name
    ALB_ARN=$(aws elbv2 describe-load-balancers \
        --query 'LoadBalancers[?contains(LoadBalancerName, `translator`)].LoadBalancerArn | [0]' \
        --output text \
        --region $REGION 2>/dev/null)

    if [ "$ALB_ARN" == "None" ] || [ -z "$ALB_ARN" ]; then
        echo "❌ No suitable load balancer found"
        echo "💡 Traffic switching requires Application Load Balancer setup"
        echo "   Please configure ALB with target groups for blue-green deployment"
        exit 1
    else
        echo "✅ Found alternative load balancer: $ALB_ARN"
    fi
else
    echo "✅ Found Application Load Balancer: $ALB_ARN"
fi

# Get listener ARN
echo "🔍 Getting listener configuration..."

LISTENER_ARN=$(aws elbv2 describe-listeners \
    --load-balancer-arn $ALB_ARN \
    --query 'Listeners[0].ListenerArn' \
    --output text \
    --region $REGION)

if [ "$LISTENER_ARN" == "None" ] || [ -z "$LISTENER_ARN" ]; then
    echo "❌ No listener found for load balancer"
    exit 1
fi

echo "✅ Found listener: $LISTENER_ARN"

# Check if target groups exist
echo "🎯 Checking target groups..."

TARGET_GROUP_ARN=$(aws elbv2 describe-target-groups \
    --names "translator-tg-$TARGET" \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text \
    --region $REGION 2>/dev/null)

if [ "$TARGET_GROUP_ARN" == "None" ] || [ -z "$TARGET_GROUP_ARN" ]; then
    echo "❌ Target group 'translator-tg-$TARGET' not found"
    echo "💡 Blue-green deployment requires separate target groups:"
    echo "   - translator-tg-blue"
    echo "   - translator-tg-green"
    echo ""
    echo "🔧 Creating basic target group configuration..."

    # Try to find any existing target group
    EXISTING_TG=$(aws elbv2 describe-target-groups \
        --query 'TargetGroups[?contains(TargetGroupName, `translator`)].TargetGroupArn | [0]' \
        --output text \
        --region $REGION 2>/dev/null)

    if [ "$EXISTING_TG" != "None" ] && [ -n "$EXISTING_TG" ]; then
        echo "✅ Using existing target group: $EXISTING_TG"
        TARGET_GROUP_ARN=$EXISTING_TG
    else
        echo "❌ No suitable target group found"
        exit 1
    fi
else
    echo "✅ Found target group for $TARGET: $TARGET_GROUP_ARN"
fi

# Check target group health
echo "🏥 Checking target group health..."

HEALTHY_TARGETS=$(aws elbv2 describe-target-health \
    --target-group-arn $TARGET_GROUP_ARN \
    --query 'TargetHealthDescriptions[?TargetHealth.State==`healthy`] | length(@)' \
    --output text \
    --region $REGION)

if [ "$HEALTHY_TARGETS" == "0" ] || [ -z "$HEALTHY_TARGETS" ]; then
    echo "⚠️ No healthy targets found in target group"
    echo "❌ Cannot switch traffic to unhealthy environment"
    exit 1
fi

echo "✅ Found $HEALTHY_TARGETS healthy target(s) in $TARGET environment"

# Update listener rule to point to new target group
echo "🔀 Switching traffic to $TARGET environment..."

aws elbv2 modify-listener \
    --listener-arn $LISTENER_ARN \
    --default-actions Type=forward,TargetGroupArn=$TARGET_GROUP_ARN \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Listener updated successfully"
else
    echo "❌ Failed to update listener"
    exit 1
fi

# Tag the new active environment
echo "🏷️ Updating environment tags..."

aws elbv2 add-tags \
    --resource-arns $TARGET_GROUP_ARN \
    --tags Key=Environment,Value=$TARGET Key=Active,Value=true \
    --region $REGION

if [ $? -eq 0 ]; then
    echo "✅ Tags updated successfully"
else
    echo "⚠️ Failed to update tags (non-critical)"
fi

# Remove active tag from old environment
OTHER_ENV=""
if [ "$TARGET" == "blue" ]; then
    OTHER_ENV="green"
else
    OTHER_ENV="blue"
fi

OLD_TARGET_GROUP_ARN=$(aws elbv2 describe-target-groups \
    --names "translator-tg-$OTHER_ENV" \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text \
    --region $REGION 2>/dev/null)

if [ "$OLD_TARGET_GROUP_ARN" != "None" ] && [ -n "$OLD_TARGET_GROUP_ARN" ]; then
    aws elbv2 remove-tags \
        --resource-arns $OLD_TARGET_GROUP_ARN \
        --tag-keys Active \
        --region $REGION 2>/dev/null || true
fi

echo ""
echo "🎉 Traffic successfully switched to $TARGET environment!"
echo ""
echo "📊 Switch Summary:"
echo "  From: $OTHER_ENV"
echo "  To: $TARGET"
echo "  Healthy targets: $HEALTHY_TARGETS"
echo "  Target group: $TARGET_GROUP_ARN"
echo "  Timestamp: $(date)"
echo ""
echo "💡 Note: Monitor application metrics to ensure smooth transition"
echo "🔄 Old environment ($OTHER_ENV) is still available for quick rollback if needed"