-- Workspace billing and subscription management
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL UNIQUE,
  subscription_tier VARCHAR(20) NOT NULL, -- 'trial', 'byoa', 'managed'
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'suspended', 'cancelled'
  trial_credits DECIMAL(10,2) DEFAULT 3.00,
  trial_credits_used DECIMAL(10,2) DEFAULT 0,
  monthly_limit DECIMAL(10,2),
  current_month_usage DECIMAL(10,2) DEFAULT 0,
  billing_email VARCHAR(255),
  payment_method VARCHAR(50), -- 'stripe', 'invoice', 'paysera'
  payment_details JSONB, -- Encrypted payment info
  trial_ends_at TIMESTAMP,
  next_billing_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_billing_workspace ON workspace_subscriptions(workspace_id);
CREATE INDEX idx_billing_status ON workspace_subscriptions(status);

-- Billing history
CREATE TABLE IF NOT EXISTS billing_history (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  invoice_id VARCHAR(100),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'EUR',
  description TEXT,
  billing_period_start DATE,
  billing_period_end DATE,
  status VARCHAR(20), -- 'pending', 'paid', 'failed', 'refunded'
  payment_method VARCHAR(50),
  transaction_id VARCHAR(255),
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_billing_history_workspace ON billing_history(workspace_id);
CREATE INDEX idx_billing_history_date ON billing_history(created_at);

-- Trigger for updated_at
CREATE TRIGGER update_workspace_subscriptions_updated_at 
  BEFORE UPDATE ON workspace_subscriptions 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Function to check subscription limits
CREATE OR REPLACE FUNCTION check_usage_limit(
    p_workspace_id VARCHAR(50),
    p_cost DECIMAL(10,6)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
BEGIN
    SELECT * INTO v_subscription
    FROM workspace_subscriptions
    WHERE workspace_id = p_workspace_id
    AND status = 'active';
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Check trial credits
    IF v_subscription.subscription_tier = 'trial' THEN
        RETURN (v_subscription.trial_credits_used + p_cost) <= v_subscription.trial_credits;
    END IF;
    
    -- Check monthly limit for other tiers
    IF v_subscription.monthly_limit IS NOT NULL THEN
        RETURN (v_subscription.current_month_usage + p_cost) <= v_subscription.monthly_limit;
    END IF;
    
    -- No limit set
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to update usage
CREATE OR REPLACE FUNCTION update_usage(
    p_workspace_id VARCHAR(50),
    p_cost DECIMAL(10,6)
)
RETURNS void AS $$
BEGIN
    UPDATE workspace_subscriptions
    SET 
        trial_credits_used = CASE 
            WHEN subscription_tier = 'trial' 
            THEN trial_credits_used + p_cost 
            ELSE trial_credits_used 
        END,
        current_month_usage = current_month_usage + p_cost,
        updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = p_workspace_id;
END;
$$ LANGUAGE plpgsql;