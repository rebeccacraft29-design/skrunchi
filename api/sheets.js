module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, receipts, tabName, spreadsheetId } = req.body;

  if (!accessToken || !receipts || !tabName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  try {
    let sheetId = spreadsheetId;

    // Create spreadsheet if first time
    if (!sheetId) {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: { title: 'Skrunchi Expenses' },
          sheets: [{ properties: { title: tabName } }]
        })
      });
      const created = await createRes.json();
      if (created.error) return res.status(400).json({ error: created.error.message });
      sheetId = created.spreadsheetId;

      // Add header row
      await addHeaders(sheetId, tabName, accessToken, headers);
      await appendRows(sheetId, tabName, receipts, accessToken, headers);
      return res.status(200).json({ spreadsheetId: sheetId, tabName, added: receipts.length });
    }

    // Check if tab exists, create if not
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers });
    const meta = await metaRes.json();
    if (meta.error) return res.status(400).json({ error: meta.error.message });

    const tabExists = meta.sheets.some(s => s.properties.title === tabName);

    if (!tabExists) {
      // Add new tab
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tabName } } }]
        })
      });
      await addHeaders(sheetId, tabName, accessToken, headers);
    }

    await appendRows(sheetId, tabName, receipts, accessToken, headers);
    return res.status(200).json({ spreadsheetId: sheetId, tabName, added: receipts.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function addHeaders(spreadsheetId, tabName, accessToken, headers) {
  const headerRow = [['Date', 'Vendor', 'Category', 'Subtotal', 'GST/HST', 'PST', 'Tip', 'Total', 'Payment Method', 'Notes']];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:J1?valueInputOption=RAW`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ values: headerRow })
  });
}

async function appendRows(spreadsheetId, tabName, receipts, accessToken, headers) {
  const rows = receipts.map(r => [
    r.date || '',
    r.vendor || '',
    r.category || '',
    (r.subtotal || '').replace('$', ''),
    (r.gst_hst || '').replace('$', ''),
    (r.pst || '').replace('$', ''),
    (r.tip || '').replace('$', ''),
    (r.total || '').replace('$', ''),
    r.payment || '',
    r.notes || ''
  ]);

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A:J:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ values: rows })
  });
}
