# PROSPEO — Final Setup Instructions

## 1. Create Demo Account in Supabase
Go to: supabase.com → your project → SQL Editor → New query
Paste the contents of: supabase/demo_user.sql
Click Run

## 2. Set yourself as Admin
After you log in with your real account:
- Go to Supabase → Authentication → Users
- Find your email → copy your UUID (looks like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)

Then in your admin HTML files, find and replace:
  YOUR_SUPABASE_USER_ID
with your real UUID

Re-upload admin.html, admin-users.html, admin-revenue.html, admin-security.html to GitHub.

## 3. Enable Google Login (optional)
- Go to console.cloud.google.com
- Create OAuth 2.0 credentials
- Authorized redirect URI: https://ferkzwzypmdtuypxribz.supabase.co/auth/v1/callback
- In Supabase → Authentication → Providers → Google → paste Client ID and Secret

## 4. Enable Microsoft Login (optional)  
- Go to portal.azure.com → App registrations → New registration
- Redirect URI: https://ferkzwzypmdtuypxribz.supabase.co/auth/v1/callback
- In Supabase → Authentication → Providers → Azure → paste credentials

## 5. Your live URLs
- App: https://samyabboute.github.io/prospeo/
- Dashboard: https://samyabboute.github.io/prospeo/app.html
- Pricing: https://samyabboute.github.io/prospeo/pricing.html
- Admin: https://samyabboute.github.io/prospeo/admin.html

## 6. Test the demo account
Email: demo@prospeo.app
Password: Demo1234!
