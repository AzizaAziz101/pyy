import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return res.status(500).json({ error: 'AWS credentials not configured' });
  }

  const { messages, system, maxTokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const client = new BedrockRuntimeClient({
    region: 'eu-central-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    },
  });

  const bedrockMessages = messages.map(m => ({
    role: m.role,
    content: [{ text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join('') }],
  }));

  const command = new ConverseStreamCommand({
    modelId: 'gpt-oss-20b',
    messages: bedrockMessages,
    ...(system && { system: [{ text: system }] }),
    inferenceConfig: {
      maxTokens: maxTokens || 2048,
    },
  });

  let bedrockRes;
  try {
    bedrockRes = await client.send(command);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of bedrockRes.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        res.write(`data: ${JSON.stringify({ text: event.contentBlockDelta.delta.text })}\n\n`);
      }
      if (event.messageStop) {
        res.write('data: [DONE]\n\n');
      }
    }
  } finally {
    res.end();
  }
}
