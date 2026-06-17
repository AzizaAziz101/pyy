import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return res.status(500).json({ error: 'AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not configured' });
  }

  const { messages, system, maxTokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const client = new BedrockRuntimeClient({
    region: 'eu-central-1',
    credentials: { accessKeyId, secretAccessKey },
  });

  const bedrockMessages = messages.map(m => ({
    role: m.role,
    content: [{ text: typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join('') }],
  }));

  const command = new ConverseStreamCommand({
    modelId: 'meta.llama3-2-3b-instruct-v1:0',
    messages: bedrockMessages,
    ...(system && { system: [{ text: system }] }),
    inferenceConfig: { maxTokens: maxTokens || 2048 },
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
      const chunk = event.contentBlockDelta?.delta?.text;
      if (chunk) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
      }
      if (event.messageStop) {
        res.write('data: [DONE]\n\n');
      }
    }
  } finally {
    res.end();
  }
}
