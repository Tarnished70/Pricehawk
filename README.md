# 🦅 PriceHawk — Real Price Tracker

## Structure
```
pricehawk/
├── index.html
├── vercel.json
├── package.json
├── schema.sql
└── api/
    ├── scrape.js
    ├── products.js
    ├── refresh.js
    ├── seed-history.js
    ├── scheduled-refresh.js
    ├── auth.js
    ├── alerts.js
    ├── db.js
    └── scraper.js
```

## Deploy to Vercel
1. Push to GitHub (keep api/ folder structure)
2. Import repo on vercel.com
3. Add env vars:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SCRAPER_API_KEY
   - RESEND_API_KEY (optional)
4. Deploy

## Supabase Setup
Run schema.sql in Supabase SQL Editor before deploying.
