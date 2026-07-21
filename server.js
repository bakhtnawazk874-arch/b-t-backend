// ============================================
// B-T AI backend — Node.js + Express + PostgreSQL
// ============================================
// Setup:
//   1. npm install
//   2. Create a .env file (copy .env.example) with your DATABASE_URL and ANTHROPIC_API_KEY
//   3. Run schema.sql on your Postgres database
//   4. node server.js
//
// This server:
//   - Serves the frontend (index.html)
//   - Handles /api/chat: saves the user message, calls the AI API, saves + returns the reply
//   - Enforces the daily free-plan limit using the usage_logs table
// ============================================

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FREE_DAILY_LIMIT = 100;
const SALT_ROUNDS = 12;

// ---------------------------------------------
// POST /api/signup
// body: { name, email, password }
// ---------------------------------------------
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, name`,
      [email, passwordHash, name || null]
    );
    const user = result.rows[0];

    // Give every new user a Free plan subscription automatically
    const freePlan = await pool.query(`SELECT id FROM plans WHERE name = 'Free'`);
    if (freePlan.rows[0]) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, plan_id, status) VALUES ($1, $2, 'active')`,
        [user.id, freePlan.rows[0].id]
      );
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, ip_address) VALUES ($1, 'signup', $2)`,
      [user.id, req.ip]
    );

    res.json({ userId: user.id, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create account. Please try again later.' });
  }
});

// ---------------------------------------------
// POST /api/login
// body: { email, password }
// ---------------------------------------------
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT id, name, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    await pool.query(
      `INSERT INTO sessions (user_id, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [user.id, req.headers['user-agent'] || null, req.ip]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, ip_address) VALUES ($1, 'login', $2)`,
      [user.id, req.ip]
    );

    res.json({ userId: user.id, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again later.' });
  }
});

// ---------------------------------------------
// POST /api/chat
// body: { conversationId, message, userId }
// ---------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { conversationId, message, userId } = req.body;

  if (!message || !userId) {
    return res.status(400).json({ error: 'message and userId are required' });
  }

  try {
    // 1. Check today's usage against the user's plan
    const today = new Date().toISOString().slice(0, 10);
    const usage = await pool.query(
      `SELECT queries_used FROM usage_logs WHERE user_id = $1 AND usage_date = $2`,
      [userId, today]
    );
    const usedToday = usage.rows[0]?.queries_used || 0;

    const planRes = await pool.query(
      `SELECT p.daily_query_limit FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'active'`,
      [userId]
    );
    const limit = planRes.rows[0]?.daily_query_limit ?? FREE_DAILY_LIMIT;

    if (limit !== null && usedToday >= limit) {
      return res.status(429).json({ error: "Today's free limit reached. Upgrade to Pro." });
    }

    // 2. Ensure a conversation exists
    let convId = conversationId;
    if (!convId) {
      const convRes = await pool.query(
        `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
        [userId, message.slice(0, 40)]
      );
      convId = convRes.rows[0].id;
    }

    // 3. Save the user's message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [convId, message]
    );

    // 4. Call the AI provider (Claude API shown here)
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: message }],
      }),
    });
    const aiData = await aiRes.json();
    const reply = aiData.content?.[0]?.text || 'Sorry, no reply was received.';

    // 5. Save the AI's reply
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [convId, reply]
    );

    // 6. Update usage count (upsert)
    await pool.query(
      `INSERT INTO usage_logs (user_id, usage_date, queries_used)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, usage_date)
       DO UPDATE SET queries_used = usage_logs.queries_used + 1`,
      [userId, today]
    );

    res.json({ reply, conversationId: convId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
});

// ---------------------------------------------
// GET /api/conversations?userId=...
// ---------------------------------------------
app.get('/api/conversations', async (req, res) => {
  try {
    const { userId } = req.query;
    const result = await pool.query(
      `SELECT id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load conversations.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`B-T AI server chal raha hai: http://localhost:${PORT}`));
