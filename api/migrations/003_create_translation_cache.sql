-- Translation cache for storing and reusing translations
CREATE TABLE IF NOT EXISTS translation_cache (
  id SERIAL PRIMARY KEY,
  hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash of source text + langs
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang VARCHAR(10),
  target_lang VARCHAR(10),
  provider VARCHAR(50), -- 'openai', 'claude', 'deepl', 'google'
  model VARCHAR(100), -- Model used for translation
  confidence DECIMAL(5,4), -- Translation confidence score
  cost DECIMAL(10,6), -- Cost of this translation
  hits INTEGER DEFAULT 0, -- Number of cache hits
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient cache lookups
CREATE INDEX idx_cache_hash ON translation_cache(hash);
CREATE INDEX idx_cache_langs ON translation_cache(source_lang, target_lang);
CREATE INDEX idx_cache_created ON translation_cache(created_at);

-- Function to update last_accessed and increment hits
CREATE OR REPLACE FUNCTION update_cache_hit()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed = CURRENT_TIMESTAMP;
    NEW.hits = OLD.hits + 1;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Cleanup old cache entries (can be scheduled)
CREATE OR REPLACE FUNCTION cleanup_old_cache()
RETURNS void AS $$
BEGIN
    -- Delete entries not accessed in last 30 days
    DELETE FROM translation_cache 
    WHERE last_accessed < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    -- Delete low-hit entries older than 7 days
    DELETE FROM translation_cache 
    WHERE hits < 5 
    AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
END;
$$ language 'plpgsql';