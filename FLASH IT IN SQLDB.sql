-- =============================================================================
-- UNIFIED E-COMMERCE PLATFORM — SUPABASE PASSWORD STORE (DIRECT DATABASE TABLE)
-- No Supabase Auth required — Direct table query via PostgREST / Service Role
-- =============================================================================
-- Instructions:
-- 1. Open your Supabase Project Dashboard (https://supabase.com/dashboard)
-- 2. Click "SQL Editor" in the left sidebar
-- 3. Click "New Query", paste this entire script, and click "Run"
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL DEFAULT 'universal_admin_password',
    password TEXT NOT NULL,
    description TEXT DEFAULT 'Master administrator password for all platform dashboards',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.admin_credentials (key, password, description)
VALUES ('universal_admin_password', 'AdminPassword123!', 'Universal master password for dashboards')
ON CONFLICT (key) DO UPDATE 
SET password = EXCLUDED.password, updated_at = NOW();

ALTER TABLE public.admin_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read for password verification" ON public.admin_credentials;

CREATE POLICY "Allow anon read for password verification" 
ON public.admin_credentials 
FOR SELECT 
TO anon, authenticated, service_role 
USING (true);
