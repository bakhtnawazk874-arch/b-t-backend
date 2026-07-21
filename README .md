# B-T AI — your own AI chat website

This is a self-hosted ChatGPT-style app. Everything stays under your control: your database, your server, your API key.

## Files
- `index.html` — frontend (works in demo mode out of the box, no setup needed to preview it)
- `auth.html` — sign up / log in page
- `server.js` — backend (Express + Postgres + AI API)
- `schema.sql` — database tables
- `package.json`, `.env.example`

## Quick preview (no backend needed)
Just open `index.html` (or `auth.html`) in a browser. It stores data in `localStorage` and gives demo replies — no server required to look around.

## Real (production) setup

1. **Create the database**
   - Install PostgreSQL (on your own VPS/server, or any Postgres hosting provider)
   - Run `schema.sql`: `psql your_database < schema.sql`

2. **Set up the backend**
   ```
   npm install
   cp .env.example .env
   ```
   Open `.env` and fill in:
   - `DATABASE_URL` — your Postgres connection string
   - `ANTHROPIC_API_KEY` — your own API key (get one at console.anthropic.com)

3. **Run the server**
   ```
   node server.js
   ```
   Your app is now live at `http://localhost:3000`.

4. **Deploy / hosting**
   Deploy the server to any VPS (DigitalOcean, AWS, or a local Pakistani provider) so everything stays under your control. Point your domain at the server.

## Security checklist
- [ ] Never commit `.env` to git/GitHub
- [ ] Keep the database accessible only from your own server (not the public internet)
- [ ] Passwords are already hashed with bcrypt — never store them as plain text
- [ ] Use HTTPS (Let's Encrypt gives free SSL certificates)
- [ ] Take regular database backups

## Next step
Authentication (`/api/signup`, `/api/login`) is already wired into `server.js` and `schema.sql`. Once your backend is running, every signed-up user automatically gets a Free plan (100 messages/day) and their own conversation history.
