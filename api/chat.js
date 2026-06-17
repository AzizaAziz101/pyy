export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) return res.status(500).json({ error: 'AWS_BEARER_TOKEN_BEDROCK not configured' });

  const { messages, system, maxTokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const openaiMessages = [];
  if (system) openaiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    openaiMessages.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join(''),
    });
  }

  const bedrockRes = await fetch(
    'https://bedrock-runtime.eu-central-1.amazonaws.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'openai.gpt-oss-120b-1:0',
        messages: openaiMessages,
        max_tokens: maxTokens || 2048,
        stream: true,
      }),
    }
  );

  if (!bedrockRes.ok) {
    const err = await bedrockRes.text();
    return res.status(bedrockRes.status).json({ error: err });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = bedrockRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}
