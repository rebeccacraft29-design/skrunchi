module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mediaType, receiptId } = req.body;
  if (!image || !mediaType || !receiptId) {
    return res.status(400).json({ error: 'Missing image, mediaType or receiptId' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // Convert base64 to binary buffer
    const buffer = Buffer.from(image, 'base64');
    const ext = mediaType === 'image/png' ? 'png' : 'jpg';
    const filename = `receipt-${receiptId}.${ext}`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${filename}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': mediaType,
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(400).json({ error: 'Upload failed: ' + err });
    }

    // Build the permanent public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/receipts/${filename}`;
    return res.status(200).json({ url: publicUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
