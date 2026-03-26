module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;

  if (!image || !mediaType) {
    return res.status(400).json({ error: 'Missing image or mediaType' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image }
            },
            {
              type: 'text',
              text: 'Parse this receipt for a Canadian small business expense app. Some receipts show two totals — one before tip and one after. If you see this, use the PRE-TIP total as the subtotal base, extract taxes from that section, extract the tip amount separately, and use the FINAL total (after tip) as the total field. Return ONLY valid JSON (no markdown): {"vendor":"name","date":"YYYY-MM-DD","category":"one of: Meals & Entertainment, Travel, Office Supplies, Software & Subscriptions, Fuel & Transportation, Accommodation, Marketing & Advertising, Professional Services, Equipment, Utilities, Other","payment_method":"if visible else empty string","subtotal":"pre-tax amount numeric","gst_hst":"GST or HST numeric or 0.00","pst":"PST numeric or 0.00","tip":"tip amount numeric or 0.00","total":"final total after tip and taxes numeric","notes":"5 words max what was purchased"}'
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    return res.status(200).json(JSON.parse(clean));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
