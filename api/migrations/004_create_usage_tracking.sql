-- Usage tracking for billing and analytics
CREATE TABLE IF NOT EXISTS usage_tracking (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50),
  channel_id VARCHAR(50),
  message_id VARCHAR(50),
  characters INTEGER NOT NULL,
  tokens_used INTEGER,
  provider VARCHAR(50),
  model VARCHAR(100),
  cost_amount DECIMAL(10,6),
  cost_currency VARCHAR(3) DEFAULT 'EUR',
  response_time_ms INTEGER,
  cache_hit BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for reporting and analytics
CREATE INDEX idx_usage_workspace ON usage_tracking(workspace_id);
CREATE INDEX idx_usage_user ON usage_tracking(user_id);
CREATE INDEX idx_usage_date ON usage_tracking(created_at);
CREATE INDEX idx_usage_workspace_date ON usage_tracking(workspace_id, created_at);

-- Partitioning by month for better performance (optional)
-- CREATE TABLE usage_tracking_2025_01 PARTITION OF usage_tracking
-- FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Function to calculate daily usage
CREATE OR REPLACE FUNCTION calculate_daily_usage(
    p_workspace_id VARCHAR(50),
    p_date DATE
)
RETURNS TABLE (
    total_translations INTEGER,
    unique_users INTEGER,
    total_cost DECIMAL(10,4),
    cache_hits INTEGER,
    avg_response_time_ms INTEGER,
    total_characters INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_translations,
        COUNT(DISTINCT user_id)::INTEGER as unique_users,
        COALESCE(SUM(cost_amount), 0)::DECIMAL(10,4) as total_cost,
        COUNT(CASE WHEN cache_hit THEN 1 END)::INTEGER as cache_hits,
        AVG(response_time_ms)::INTEGER as avg_response_time_ms,
        SUM(characters)::INTEGER as total_characters
    FROM usage_tracking
    WHERE workspace_id = p_workspace_id
    AND DATE(created_at) = p_date;
END;
$$ LANGUAGE plpgsql;