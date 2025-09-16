-- Channel configuration for translation settings per channel
CREATE TABLE IF NOT EXISTS channel_configs (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(50) NOT NULL,
  channel_name VARCHAR(100),
  workspace_id VARCHAR(50) NOT NULL,
  translation_enabled BOOLEAN DEFAULT false,
  allowed_users TEXT[], -- Array of user IDs allowed to translate
  blocked_languages TEXT[], -- Languages not to translate in this channel
  max_cost_per_message DECIMAL(10,4),
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, workspace_id)
);

-- Indexes
CREATE INDEX idx_channel_workspace ON channel_configs(channel_id, workspace_id);
CREATE INDEX idx_workspace_channels ON channel_configs(workspace_id);

-- Updated_at trigger
CREATE TRIGGER update_channel_configs_updated_at 
  BEFORE UPDATE ON channel_configs 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();