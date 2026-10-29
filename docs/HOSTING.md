# Rahi — Real Hosting (Render, free test tier)

Live link ke liye Rahi ko asli hosting par chalana hota hai. Ye
guide Render par free test hosting ke liye hai — aik dashboard,
teen cheezein: API + Postgres + admin web app. (Vercel waghera par
bhi ho sakta hai, lekin Render par poora stack aik jagah ban jata
hai, is liye ye rasta chuna gaya hai.)

## Pehle ye samajh lein (zaroori)

- **Ye TEST hosting hai, production nahi.** Data test-only hai.
- Render ka **free tier sota hai** jab koi use na kar raha ho:
  pehli load me 30–60 second lag sakte hain. Ye kharabi nahi hai.
- Render ka **free Postgres aam tor par 30 din ke baad expire ho
  jata hai**. Test ke liye theek hai; lambi muddat ke liye paid
  database chahiye hoga.
- SMS asli me nahi jayega: `SMS_PROVIDER=log` hai, is liye phone
  OTP API ke logs me likha jayega. **Admin login (email +
  password) ko SMS ki zaroorat nahi**, is liye admin test seedha
  chalega.
- Service ke naam badle to URL bhi badlenge: admin build me API
  ka URL `https://rahi-api.onrender.com/api/v1` likha hota hai,
  aur API ki CORS allow-list me `https://rahi-admin.onrender.com`
  hai. Naam wohi rakhein jo `render.yaml` me hain.

## Step 0 — Accounts (ye 2 kaam sirf aap kar sakte hain)

1. **GitHub account** (agar nahi hai to github.com par free
   signup karein) aur aik **khaali repo** banayein, naam kuch
   bhi, masalan `rahi-platform`.
2. **Render account** (render.com par free signup karein) aur
   use apne GitHub se connect karein (Render ye khud poochega).

Code ko GitHub repo me daalna: ya to aap khud push karein, ya
mujhe repo ka link + push ki ijazat dein to main push kar doon.
Jab tak code GitHub par nahi, Render deploy nahi kar sakta.

## Step 1 — Blueprint se deploy karein

1. Render dashboard me **New → Blueprint** chunein.
2. Apna `rahi-platform` repo select karein.
3. Render teen services dikhaye ga: `rahi-api`, `rahi-db`,
   `rahi-admin`. **ENCRYPTION_KEY** maangega — jo key maine
   chat me di hai wo yahan paste karein (ye key repo me kahin
   nahi likhi, sirf Render ke dashboard me rahegi).
4. **Apply** dabayein. Pehla build kuch minute lega (API ka
   Docker build + admin ka Next build).

## Step 2 — Database tables banayein (aik dafa)

API khud migrations nahi chalata (by design). Deploy ke baad:

1. Render dashboard me `rahi-api` service kholein → **Shell**.
2. Ye command chalayein:
   ```
   ./scripts/run-migrations.sh
   ```
   Tables khaali banengi (seed data nahi — ye by design hai).

## Step 3 — Pehla admin banayein (aik dafa)

Usi Shell me ye command chalayein (email/password apni marzi
ke rakhein, password kam az kam 12 characters):

```
ADMIN_EMAIL=admin@rahi.test ADMIN_PASSWORD=<mazboot-password> node scripts/create-admin.mjs
```

Agar email pehle se mojood ho to ye mana kar dega (overwrite
nahi karega) — ye hifazat ke liye hai.

## Step 4 — Test karein

1. `https://rahi-admin.onrender.com` kholein (pehli load me
   30–60 second lag sakte hain — free tier soya hota hai).
2. Step 3 wale email/password se login karein.
3. Cities me Lahore nazar aana chahiye (seedha database se nahi
   — Lahore ko pehle Cities page se add karna hoga, ya API se;
   test data ke liye Cities → Add City se Lahore add karein:
   centre 31.5204, 74.3587, currency PKR, timezone Asia/Karachi).

## Agar kuch ghalat ho

- **API health:** `https://rahi-api.onrender.com/api/v1/health`
  par `{"status":"ok"}` aana chahiye. Agar nahi, to Render ke
  `rahi-api` logs dekhein.
- **Admin khul raha hai lekin login fail:** ya to Step 3 nahi
  hua, ya CORS_ORIGINS me admin ka URL ghalat hai.
- **Pehli load slow:** free tier ka sleep hai, dobara load
  karein to tez ho jayega.

## Baad me (jab test kamyab ho jaye)

- Flutter customer/driver apps ke liye API ka URL badalna hoga
  (`https://rahi-api.onrender.com/api/v1`).
- Asli SMS ke liye Twilio account + `SMS_PROVIDER=twilio` aur
  4 env vars set karne honge (dekhein `docs/SMS-DELIVERY.md`).
- Production ke liye paid database + paid instances + domain
  chahiye honge — free tier sirf test ke liye hai.
