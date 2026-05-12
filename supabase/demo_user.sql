
-- Create demo user for Prospeo
-- Run this in Supabase SQL Editor

-- Insert demo user into auth.users (Supabase managed table)
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'demo@prospeo.app',
  crypt('Demo1234!', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Demo User"}',
  false,
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Create profile for demo user
INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'demo@prospeo.app',
  'Demo User',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create free subscription for demo user
INSERT INTO public.subscriptions (user_id, plan, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'free',
  'active',
  NOW(),
  NOW()
) ON CONFLICT (user_id) DO NOTHING;
