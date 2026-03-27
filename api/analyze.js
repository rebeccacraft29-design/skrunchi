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
              text: 'You are parsing a Canadian restaurant or business receipt. Extract these fields carefully and return ONLY valid JSON with no markdown.\n\nCRITICAL RULES:\n- "subtotal" = the food/items amount BEFORE taxes\n- "gst_hst" = ONLY the GST or HST tax line (government tax, usually 5% or 13%)\n- "pst" = ONLY the PST tax line if present (0.00 if not shown)\n- "tip" = ONLY the gratuity/tip the customer added (0.00 if not a restaurant or no tip)\n- "total" = the FINAL amount paid including all taxes and tip\n- NEVER put a tax amount in the tip field\n- NEVER put a tip amount in a tax field\n- If you see a line labeled "Tax", "GST", "HST", or "TVQ" it goes in gst_hst\n- If you see a line labeled "Tip", "Gratuity", or "Pourboire" it goes in tip\n- Some receipts show two totals: subtotal before tip, then final after tip — use the FINAL total\n\nReturn JSON: {"vendor":"business name","date":"YYYY-MM-DD","category":"one of: Meals & Entertainment, Travel, Office Supplies, Software & Subscriptions, Fuel & Transportation, Accommodation, Marketing & Advertising, Professional Services, Equipment, Utilities, Other","payment_method":"card type if visible else empty string","subtotal":"numeric amount before tax","gst_hst":"tax amount numeric","pst":"PST amount numeric or 0.00","tip":"tip amount numeric or 0.00","total":"final total numeric","notes":"5 words max describing purchase"}'
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
