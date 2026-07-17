# Guftgu — apni AI chat website

Yeh ek self-hosted ChatGPT-style app hai. Sab kuch aapke control mein hai: aapka database, aapka server, aapki API key.

## Files
- `index.html` — frontend (abhi demo mode mein hai, koi setup ke bina browser mein khol kar dekh sakte hain)
- `server.js` — backend (Express + Postgres + AI API)
- `schema.sql` — database tables (pehle is se banaya gaya)
- `package.json`, `.env.example`

## Turant demo dekhne ke liye
Bas `index.html` ko browser mein khol lein. Yeh localStorage mein data save karega aur demo jawabat dega — koi backend chalane ki zaroorat nahi.

## Real (production) setup

1. **Database banayein**
   - PostgreSQL install karein (apne VPS/server pe, ya kisi bhi Postgres host pe)
   - `schema.sql` file run karein: `psql your_database < schema.sql`

2. **Backend setup karein**
   ```
   npm install
   cp .env.example .env
   ```
   `.env` file kholain aur bharain:
   - `DATABASE_URL` — apne Postgres ka connection string
   - `ANTHROPIC_API_KEY` — apni API key (console.anthropic.com se milegi)

3. **Server chalayein**
   ```
   node server.js
   ```
   Ab `http://localhost:3000` pe aapki app live hai.

4. **Frontend ko backend se connect karein**
   `index.html` mein `getAIResponse()` function ko update karein taake wo `userId` bhi bheje (abhi yeh sirf demo ke liye simplified hai) — login/signup system add karne ke baad `userId` session se aayega.

5. **Deploy / hosting**
   Apna server kisi bhi VPS (DigitalOcean, AWS, ya Pakistan mein local provider) pe deploy karein taake sab kuch aapke control mein rahe. Domain khareed kar server se point kar dein.

## Security checklist
- [ ] `.env` file kabhi git/GitHub pe upload na karein
- [ ] Database ko sirf apne server se accessible rakhein (public internet se nahi)
- [ ] Passwords hamesha hashed store karein (bcrypt/argon2) — abhi yeh login system add karna baaki hai
- [ ] HTTPS use karein (Let's Encrypt se free SSL certificate mil jata hai)
- [ ] Regular database backups lein

## Agla step
Abhi is app mein login/signup (authentication) shamil nahi hai — har user ek fixed demo ID use kar raha hai. Agla zaroori kaam yeh hai ke ek proper signup/login system banayein taake har user ka apna alag account, apni conversations, aur apna plan ho.
