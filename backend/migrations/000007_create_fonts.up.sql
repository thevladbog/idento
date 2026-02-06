-- Custom fonts for badge printing (per event)
CREATE TABLE IF NOT EXISTS fonts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    family VARCHAR(255) NOT NULL,
    weight VARCHAR(50) DEFAULT 'normal',
    style VARCHAR(50) DEFAULT 'normal',
    format VARCHAR(50) NOT NULL,
    data BYTEA NOT NULL,
    size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    license_accepted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster event lookup
CREATE INDEX IF NOT EXISTS idx_fonts_event_id ON fonts(event_id);

-- Constraint: unique font family + weight + style per event
CREATE UNIQUE INDEX IF NOT EXISTS idx_fonts_unique_family 
ON fonts(event_id, family, weight, style);
