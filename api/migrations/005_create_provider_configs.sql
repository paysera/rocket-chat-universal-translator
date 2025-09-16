-- Provider configurations for AI translation services
CREATE TABLE IF NOT EXISTS provider_configs (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  provider_id VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', 'deepl', 'google'
  api_key_encrypted TEXT, -- Encrypted API key
  preferences JSONB DEFAULT '{}', -- Provider-specific settings
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0, -- Higher priority = preferred provider
  rate_limit INTEGER, -- Requests per minute
  monthly_quota DECIMAL(10,2), -- Monthly spending limit
  current_month_usage DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, provider_id)
);

-- Indexes
CREATE INDEX idx_provider_workspace ON provider_configs(workspace_id);
CREATE INDEX idx_provider_active ON provider_configs(workspace_id, is_active);

-- Trigger for updated_at
CREATE TRIGGER update_provider_configs_updated_at 
  BEFORE UPDATE ON provider_configs 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Reset monthly usage (to be called by scheduler)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
    UPDATE provider_configs
    SET current_month_usage = 0
    WHERE EXTRACT(DAY FROM CURRENT_TIMESTAMP) = 1;
END;
$$ language 'plpgsql';