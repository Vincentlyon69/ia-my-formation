
-- ===================================================
-- SCHÉMA DE BASE DE DONNÉES SUPABASE POUR MYM FORMATION
-- ===================================================

-- Table pour les codes d'accès
CREATE TABLE IF NOT EXISTS access_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(12) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    client_name VARCHAR(255),
    price DECIMAL(10,2) NOT NULL,
    level INTEGER NOT NULL CHECK (level IN (1,2,3)), -- 1=Débutant, 2=Avancé, 3=Expert
    duration_days INTEGER NOT NULL, -- -1 pour illimité
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id)
);

-- Table pour les sessions utilisateur
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    access_code_id UUID REFERENCES access_codes(id),
    email VARCHAR(255) NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- Table pour les logs d'activité
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    access_code_id UUID REFERENCES access_codes(id),
    session_id UUID REFERENCES user_sessions(id),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fonction pour générer un code d'accès unique
CREATE OR REPLACE FUNCTION generate_access_code()
RETURNS VARCHAR(12) AS $$
DECLARE
    chars VARCHAR(36) := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result VARCHAR(12) := '';
    i INTEGER;
BEGIN
    FOR i IN 1..12 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;

    -- Vérifier l'unicité
    IF EXISTS(SELECT 1 FROM access_codes WHERE code = result) THEN
        RETURN generate_access_code(); -- Récursion si le code existe déjà
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer un nouveau code d'accès
CREATE OR REPLACE FUNCTION create_access_code(
    p_email VARCHAR(255),
    p_client_name VARCHAR(255),
    p_price DECIMAL(10,2),
    p_level INTEGER,
    p_duration_days INTEGER,
    p_created_by UUID
)
RETURNS TABLE(
    code VARCHAR(12),
    expires_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    new_code VARCHAR(12);
    expiry_date TIMESTAMP WITH TIME ZONE;
BEGIN
    new_code := generate_access_code();

    IF p_duration_days = -1 THEN
        expiry_date := NULL; -- Accès illimité
    ELSE
        expiry_date := NOW() + (p_duration_days || ' days')::INTERVAL;
    END IF;

    INSERT INTO access_codes (code, email, client_name, price, level, duration_days, expires_at, created_by)
    VALUES (new_code, p_email, p_client_name, p_price, p_level, p_duration_days, expiry_date, p_created_by);

    RETURN QUERY SELECT new_code, expiry_date;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour vérifier un code d'accès
CREATE OR REPLACE FUNCTION verify_access_code(p_code VARCHAR(12), p_email VARCHAR(255))
RETURNS TABLE(
    is_valid BOOLEAN,
    level INTEGER,
    expires_at TIMESTAMP WITH TIME ZONE,
    client_name VARCHAR(255)
) AS $$
DECLARE
    code_record RECORD;
BEGIN
    SELECT * INTO code_record 
    FROM access_codes 
    WHERE code = p_code AND email = p_email AND is_active = TRUE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, NULL::TIMESTAMP WITH TIME ZONE, NULL::VARCHAR(255);
        RETURN;
    END IF;

    -- Vérifier l'expiration
    IF code_record.expires_at IS NOT NULL AND code_record.expires_at < NOW() THEN
        RETURN QUERY SELECT FALSE, 0, NULL::TIMESTAMP WITH TIME ZONE, NULL::VARCHAR(255);
        RETURN;
    END IF;

    -- Marquer comme utilisé si c'est la première fois
    IF code_record.used_at IS NULL THEN
        UPDATE access_codes SET used_at = NOW() WHERE id = code_record.id;
    END IF;

    RETURN QUERY SELECT TRUE, code_record.level, code_record.expires_at, code_record.client_name;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer une session utilisateur
CREATE OR REPLACE FUNCTION create_user_session(
    p_code VARCHAR(12),
    p_email VARCHAR(255),
    p_ip_address INET,
    p_user_agent TEXT
)
RETURNS VARCHAR(255) AS $$
DECLARE
    code_id UUID;
    session_token VARCHAR(255);
    session_expiry TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Récupérer l'ID du code d'accès
    SELECT id INTO code_id FROM access_codes WHERE code = p_code AND email = p_email;

    IF code_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Générer un token de session unique
    session_token := encode(gen_random_bytes(32), 'hex');
    session_expiry := NOW() + INTERVAL '24 hours';

    -- Créer la session
    INSERT INTO user_sessions (access_code_id, email, session_token, ip_address, user_agent, expires_at)
    VALUES (code_id, p_email, session_token, p_ip_address, p_user_agent, session_expiry);

    RETURN session_token;
END;
$$ LANGUAGE plpgsql;

-- RLS (Row Level Security) Policies
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Policy pour access_codes - seul le créateur peut voir ses codes
CREATE POLICY "Users can only see their own access codes" ON access_codes
    FOR ALL USING (auth.uid() = created_by);

-- Policy pour user_sessions - utilisateurs peuvent voir leurs propres sessions
CREATE POLICY "Users can see their own sessions" ON user_sessions
    FOR SELECT USING (
        email = (SELECT email FROM access_codes WHERE id = access_code_id AND created_by = auth.uid())
        OR
        EXISTS (SELECT 1 FROM access_codes WHERE code IN (
            SELECT ac.code FROM access_codes ac WHERE ac.email = user_sessions.email
        ))
    );

-- Policy pour activity_logs
CREATE POLICY "Users can see related activity logs" ON activity_logs
    FOR SELECT USING (
        access_code_id IN (SELECT id FROM access_codes WHERE created_by = auth.uid())
    );

-- Index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);
CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);
CREATE INDEX IF NOT EXISTS idx_access_codes_created_by ON access_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions(email);

-- Vue pour les statistiques administrateur
CREATE OR REPLACE VIEW admin_stats AS
SELECT 
    COUNT(*) as total_codes,
    COUNT(*) FILTER (WHERE is_active = true) as active_codes,
    COUNT(*) FILTER (WHERE used_at IS NOT NULL) as used_codes,
    SUM(price) as total_revenue,
    AVG(price) as average_price,
    COUNT(*) FILTER (WHERE level = 1) as level_1_count,
    COUNT(*) FILTER (WHERE level = 2) as level_2_count,
    COUNT(*) FILTER (WHERE level = 3) as level_3_count
FROM access_codes
WHERE created_by = auth.uid();
