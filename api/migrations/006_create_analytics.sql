-- Analytics aggregation tables for reporting
CREATE TABLE IF NOT EXISTS analytics_daily (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  total_translations INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  cache_hit_rate DECIMAL(5,2), -- Percentage
  avg_response_time_ms INTEGER,
  total_characters INTEGER DEFAULT 0,
  top_language_pairs JSONB, -- [{"from": "es", "to": "en", "count": 100}]
  provider_breakdown JSONB, -- {"openai": 50, "claude": 30, "google": 20}
  error_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, date)
);

-- Indexes
CREATE INDEX idx_analytics_workspace_date ON analytics_daily(workspace_id, date);
CREATE INDEX idx_analytics_date ON analytics_daily(date);

-- Monthly aggregation
CREATE TABLE IF NOT EXISTS analytics_monthly (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_translations INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  avg_daily_translations DECIMAL(10,2),
  top_users JSONB, -- [{"user_id": "xxx", "count": 1000}]
  language_distribution JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, year, month)
);

CREATE INDEX idx_analytics_monthly ON analytics_monthly(workspace_id, year, month);

-- Function to aggregate daily analytics
CREATE OR REPLACE FUNCTION aggregate_daily_analytics(p_date DATE)
RETURNS void AS $$
DECLARE
    v_workspace RECORD;
BEGIN
    -- Loop through all workspaces with activity
    FOR v_workspace IN 
        SELECT DISTINCT workspace_id 
        FROM usage_tracking 
        WHERE DATE(created_at) = p_date
    LOOP
        INSERT INTO analytics_daily (
            workspace_id,
            date,
            total_translations,
            unique_users,
            total_cost,
            cache_hits,
            cache_hit_rate,
            avg_response_time_ms,
            total_characters,
            error_count
        )
        SELECT 
            v_workspace.workspace_id,
            p_date,
            COUNT(*),
            COUNT(DISTINCT user_id),
            COALESCE(SUM(cost_amount), 0),
            COUNT(CASE WHEN cache_hit THEN 1 END),
            CASE 
                WHEN COUNT(*) > 0 
                THEN (COUNT(CASE WHEN cache_hit THEN 1 END)::DECIMAL / COUNT(*) * 100)
                ELSE 0 
            END,
            AVG(response_time_ms)::INTEGER,
            SUM(characters),
            COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END)
        FROM usage_tracking
        WHERE workspace_id = v_workspace.workspace_id
        AND DATE(created_at) = p_date
        ON CONFLICT (workspace_id, date) 
        DO UPDATE SET
            total_translations = EXCLUDED.total_translations,
            unique_users = EXCLUDED.unique_users,
            total_cost = EXCLUDED.total_cost,
            cache_hits = EXCLUDED.cache_hits,
            cache_hit_rate = EXCLUDED.cache_hit_rate,
            avg_response_time_ms = EXCLUDED.avg_response_time_ms,
            total_characters = EXCLUDED.total_characters,
            error_count = EXCLUDED.error_count;
    END LOOP;
END;
$$ LANGUAGE plpgsql;