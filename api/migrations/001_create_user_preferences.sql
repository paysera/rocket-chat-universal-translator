-- User preferences table for storing individual language settings
CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  username VARCHAR(100),
  workspace_id VARCHAR(50) NOT NULL,
  source_language VARCHAR(10) DEFAULT 'auto',
  target_language VARCHAR(10) NOT NULL DEFAULT 'en',
  quality_tier VARCHAR(20) DEFAULT 'balanced', -- 'fast', 'balanced', 'quality'
  auto_translate BOOLEAN DEFAULT true,
  show_original_hover BOOLEAN DEFAULT true,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workspace_id)
);

-- Indexes for faster queries
CREATE INDEX idx_user_workspace ON user_preferences(user_id, workspace_id);
CREATE INDEX idx_workspace_users ON user_preferences(workspace_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_preferences_updated_at 
  BEFORE UPDATE ON user_preferences 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();