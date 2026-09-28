// Table Finder backend for Games R Us.
// Holds the Anthropic key server-side (ANTHROPIC_API_KEY in Vercel env vars),
// grounds the model in data/gub.json, and returns plain text with MATCH: lines.
const fs = require('fs');
const path = require('path');

const MAX_MESSAGES = 24;
const MAX_CHARS_PER_MESSAGE = 2000;
const MAX_TOTAL_CHARS = 20000;
const DEFAULT_MODEL = 'claude-sonnet-5';
const TOP_ENTRIES = 6;

let GUB = null;
function loadGub() {
  if (!GUB) {
    const file = path.join(process.cwd(), 'data', 'gub.json');
    GUB = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return GUB;
}

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 2);
}

// Score each entry against the whole conversation so follow-up answers
// ("just me", "something fast") still pull in the right tables.
function pickEntries(entries, messages) {
  const convo = messages.map((m) => m.content).join(' ');
  const words = new Set(tokens(convo));
  const scored = entries.map((e) => {
    let score = 0;
    const tagWords = tokens((e.tags || []).join(' '));
    const titleWords = tokens(e.title);
    const bodyWords = tokens(e.summary + ' ' + e.body);
    tagWords.forEach((w) => { if (words.has(w)) score += 3; });
    titleWords.forEach((w) => { if (words.has(w)) score += 4; });
    bodyWords.forEach((w) => { if (words.has(w)) score += 0.25; });
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_ENTRIES).map((s) => s.e);
}

function buildSystem(gub, picked) {
  const index = gub.entries.map((e) => `- ${e.id}: ${e.title}. ${e.summary}`).join('\n');
  const detail = picked
    .map((e) => `### ${e.id} | ${e.title}\n${e.body}\nDetails: ${JSON.stringify(e.details)}`)
    .join('\n\n');
  return [
    'You are the Table Finder for Games R Us, a free, for-entertainment-only hub of card and casino-style games by AI & I. No real money is ever involved.',
    'Your job: help the visitor pick the right table (and, for Blind Poker Fury, the right rules and options) based on what they tell you, and answer rules questions.',
    '',
    'How to talk:',
    '- Plain, warm, short. Two to five sentences per reply. No markdown headings, no bullet lists, no bold.',
    '- If the request is too vague to recommend well, ask exactly ONE targeted clarifying question (for example: alone or with friends, luck or strategy, fast or slow). Never ask more than one question per reply, and never ask something they already answered.',
    '- Once you know enough, give a specific recommendation: the table, the exact settings to choose if relevant, and one concrete next step (for example: "Open Blind Poker Fury, go to Table setup, pick Blind rules and turn Straddle on").',
    '- Only describe tables, rules and features that appear in the knowledge below. If something is not built (like the roulette table or leaderboards), say so plainly. Never invent games, prizes, features or real-money play.',
    '',
    'Match lines (required whenever you recommend, including partial recommendations):',
    'After your visible reply, add one line per recommended option, best first, up to three, each exactly in this form on its own line:',
    'MATCH: {"id":"<entry id from the knowledge>","title":"<title>","score":<0-100 fit for this visitor>,"why":"<one sentence tailored to them>","details":{"<Label>":"<Value>"}}',
    'Use only ids that exist below. Put 3 to 5 of the most relevant facts in details, and when you recommend settings include a "Suggested setup" detail. Output valid JSON on each MATCH line. When you are only asking a clarifying question and cannot rank yet, omit MATCH lines.',
    '',
    'All tables (index):',
    index,
    '',
    'Most relevant tables for this conversation (full detail):',
    detail,
  ].join('\n');
}

function validate(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return 'Send a JSON body with a messages array.';
  const msgs = body.messages;
  if (msgs.length < 1) return 'Type a message first.';
  if (msgs.length > MAX_MESSAGES) return 'The conversation is too long. Start a new chat to keep going.';
  let total = 0;
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return 'Each message needs a role and text.';
    const len = m.content.trim().length;
    if (len === 0) return 'Messages cannot be empty.';
    if (len > MAX_CHARS_PER_MESSAGE) return 'That message is too long. Keep it under 2,000 characters.';
    total += len;
  }
  if (total > MAX_TOTAL_CHARS) return 'The conversation is too long. Start a new chat to keep going.';
  if (msgs[msgs.length - 1].role !== 'user') return 'The last message must be from you.';
  if (msgs[0].role !== 'user') return 'The conversation must start with your message.';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'The request was not valid JSON.' }); }
  }
  const problem = validate(body);
  if (problem) return res.status(400).json({ error: problem });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'The Table Finder is not switched on yet. The site owner needs to add the API key in Vercel.' });

  let gub;
  try { gub = loadGub(); } catch (e) { return res.status(500).json({ error: 'The table list could not be loaded.' }); }

  const messages = body.messages.map((m) => ({ role: m.role, content: m.content.trim() }));
  const system = buildSystem(gub, pickEntries(gub.entries, messages));

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 2000,
        system,
        messages,
      }),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'The Table Finder could not reach the model. Try again in a moment.' });
    const data = await upstream.json();
    const reply = (data.content || [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!reply) return res.status(502).json({ error: 'The Table Finder came back empty. Try asking again.' });
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: 'The Table Finder could not reach the model. Try again in a moment.' });
  }
};

// exported for local tests only
module.exports._internals = { pickEntries, buildSystem, validate, loadGub };
