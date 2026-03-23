# 🦅 PriceHawk — Real Price Tracker
### College Project | Full-Stack | Amazon & Flipkart

A production-ready price tracker that **actually scrapes live prices** from Amazon.in and Flipkart, stores history in a real database, and alerts you when prices drop.

---

## Tech Stack
| Layer | Technology | Cost |
|---|---|---|
| Frontend | HTML + CSS + JS (Chart.js) | Free |
| Backend | Netlify Functions (Node.js) | Free |
| Database | Supabase (PostgreSQL) | Free |
| Scraping | Cheerio + ScraperAPI | Free tier |
| Hosting | Netlify | Free |

---

## Setup (follow in order)

### Step 1 — Supabase Database

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name it `pricehawk`, set a password, choose region **South Asia (Mumbai)**
3. Wait ~2 minutes for it to start
4. Go to **SQL Editor** → **New Query**
5. Paste the contents of `schema.sql` and click **Run**
6. Go to **Settings → API** and copy:
   - `Project URL` → this is your `SUPABASE_URL`
   - `anon public` key → this is your `SUPABASE_ANON_KEY`

---

### Step 2 — ScraperAPI (for reliable scraping)

1. Go to [scraperapi.com](https://www.scraperapi.com) → Sign up free
2. Free tier gives **1,000 API calls/month** (enough for demos)
3. Copy your **API Key** from the dashboard

> ⚠️ Without ScraperAPI, Amazon will often block direct scrapes. Flipkart may work without it.

---

### Step 3 — GitHub Repository

```bash
# Create a new GitHub repo called 'pricehawk', then:
git init
git add .
git commit -m "Initial PriceHawk commit"
git remote add origin https://github.com/YOUR_USERNAME/pricehawk.git
git push -u origin main
```

---

### Step 4 — Netlify Deployment

1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub repo
3. Build settings:
   - **Build command:** `npm install`
   - **Publish directory:** `.` (just a dot)
4. Click **Deploy site**
5. Once deployed, go to **Site configuration → Environment variables → Add variable**

Add these 3 variables:
```
SUPABASE_URL        = https://xxxx.supabase.co
SUPABASE_ANON_KEY   = eyJhbG...your anon key...
SCRAPER_API_KEY     = your_scraperapi_key_here
```

6. Go to **Deploys → Trigger deploy** to redeploy with the new env vars

---

### Step 5 — Test It

1. Open your Netlify URL (e.g. `https://pricehawk.netlify.app`)
2. Click **+ Add Product**
3. Paste: `https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX2SLKB`
4. Click **🔍 Fetch Info** — it should auto-fill the price and name
5. Set a target price and click **Track Product**
6. Click **🔄 Refresh** to scrape current prices

---

## How Price History Works

- When you add a product, **1 data point** is saved (today's scraped price)
- Every time you click **Refresh**, a new price point is added (max 1 per day)
- Over time the charts will show real history
- The more you refresh, the richer the history

> 💡 For a college demo, add products a few days before and refresh daily!

---

## Project Structure

```
pricehawk/
├── index.html                    # Frontend (all UI)
├── netlify.toml                  # Netlify config + URL redirects
├── package.json                  # Node dependencies
├── schema.sql                    # Supabase database schema
└── netlify/
    ├── functions/
    │   ├── scrape.js             # POST /api/scrape  → fetches price from URL
    │   ├── products.js           # GET/POST/PUT/DELETE /api/products
    │   └── refresh.js            # POST /api/refresh → re-scrapes all prices
    └── utils/
        ├── scraper.js            # Shared scraping logic (Cheerio)
        └── db.js                 # Shared Supabase client
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/scrape` | Scrape price+name from a URL |
| `GET` | `/api/products` | Get all your tracked products |
| `POST` | `/api/products` | Add a new product |
| `PUT` | `/api/products` | Update product details |
| `DELETE` | `/api/products` | Delete a product |
| `POST` | `/api/refresh` | Re-scrape all product prices |

---

## Features
- ✅ Real live price scraping (Amazon.in + Flipkart.com)
- ✅ Price history charts (builds over time with real data)
- ✅ Price alerts (get notified when target price is hit)
- ✅ Compare products side-by-side
- ✅ Wishlist / favorites
- ✅ Analytics dashboard
- ✅ Export to CSV
- ✅ Each user has isolated data (session-based)
- ✅ All data persists in PostgreSQL via Supabase

---

## Troubleshooting

**"Price not found" on Amazon:**
- Make sure `SCRAPER_API_KEY` is set in Netlify env vars
- Amazon aggressively blocks scrapers without proxy rotation

**"Could not load products" on startup:**
- Check that `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- Make sure you ran the `schema.sql` in Supabase SQL editor

**Function timeout:**
- Scraping can take 10–25 seconds; this is normal
- If it times out, try again (Netlify free tier has 10s timeout for sync functions)
