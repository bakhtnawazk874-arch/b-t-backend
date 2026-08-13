// ============================================
// B-T AI backend — Node.js + Express + PostgreSQL
// ============================================

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const FREE_DAILY_LIMIT = 100;
const SALT_ROUNDS = 12;

// ---------------------------------------------
// POST /api/signup
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
// ---------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { conversationId, message, userId } = req.body;

  if (!message || !userId) {
    return res.status(400).json({ error: 'message and userId are required' });
  }

  try {
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

    let convId = null;
    if (conversationId) {
      const existing = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, userId]
      );
      if (existing.rows[0]) convId = existing.rows[0].id;
    }
    if (!convId) {
      const convRes = await pool.query(
        `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
        [userId, message.slice(0, 40)]
      );
      convId = convRes.rows[0].id;
    }

    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [convId, message]
    );

    // Call the AI provider (Groq — fast, free, OpenAI-compatible API)
    const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: message }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiData.choices) {
      console.error('Groq API did not return choices:', JSON.stringify(aiData));
    }
    const reply = aiData.choices?.[0]?.message?.content || 'Sorry, no reply was received.';

    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [convId, reply]
    );

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

// ---------------------------------------------
// POST /api/generate-image
// (Pollinations.ai — free, no API key needed)
// ---------------------------------------------
app.post('/api/generate-image', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const encodedPrompt = encodeURIComponent(prompt.trim());
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

    // We just hand back the URL — the browser loads the actual image
    // directly from Pollinations, so our server doesn't do heavy lifting.
    res.json({ imageUrl });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: 'Image generation failed. Please try again later.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`B-T AI server chal raha hai: http://localhost:${PORT}`));
