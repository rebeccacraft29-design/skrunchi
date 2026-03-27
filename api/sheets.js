module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, receipts, tabName, spreadsheetId, sheetUrl } = req.body;

  // If sheetUrl provided, extract spreadsheet ID from it
  let sheetId = spreadsheetId;
  if (!sheetId && sheetUrl) {
    const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) sheetId = match[1];
  }

  if (!accessToken || !receipts || !tabName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const BLACK = { red: 0.067, green: 0.075, blue: 0.094 };
  const ORANGE = { red: 1, green: 0.482, blue: 0.208 };
  const GREY_ROW = { red: 0.937, green: 0.937, blue: 0.937 };
  const WHITE = { red: 1, green: 1, blue: 1 };

  try {
    let tabSheetId = null;

    if (!sheetId) {
      // Create new spreadsheet
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST', headers,
        body: JSON.stringify({
          properties: { title: 'Skrunchi Expenses' },
          sheets: [{ properties: { title: tabName } }]
        })
      });
      const created = await createRes.json();
      if (created.error) return res.status(400).json({ error: created.error.message });
      sheetId = created.spreadsheetId;
      tabSheetId = created.sheets[0].properties.sheetId;
    } else {
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers });
      const meta = await metaRes.json();
      if (meta.error) return res.status(400).json({ error: meta.error.message });
      const existingTab = meta.sheets.find(s => s.properties.title === tabName);
      if (existingTab) {
        tabSheetId = existingTab.properties.sheetId;
      } else {
        const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          method: 'POST', headers,
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] })
        });
        const addData = await addRes.json();
        tabSheetId = addData.replies[0].addSheet.properties.sheetId;
      }
    }

    // HEADERS — now includes Employee, Reimbursable, and all financial columns
    const headerRow = [['Employee', 'Date', 'Vendor', 'Category', 'Subtotal', 'GST/HST', 'PST', 'Tip', 'Total', 'Payment Method', 'Reimbursable', 'Notes', 'Photo']];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A1:M1?valueInputOption=RAW`, {
      method: 'PUT', headers, body: JSON.stringify({ values: headerRow })
    });

    // Get current row count
    const rangeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A:A`, { headers });
    const rangeData = await rangeRes.json();
    const startRow = (rangeData.values || []).length + 1;

    // DATA ROWS
    const rows = receipts.map(r => [
      r.submittedBy || '',
      r.date || '',
      r.vendor || '',
      r.category || '',
      (r.subtotal || '').replace('$', ''),
      (r.gst_hst || '').replace('$', ''),
      (r.pst || '').replace('$', ''),
      (r.tip || '').replace('$', ''),
      (r.total || '').replace('$', ''),
      r.payment || '',
      r.reimbursable === false ? 'Company Card' : 'Reimbursable',
      r.notes || '',
      r.imageUrl ? '📷 Photo captured' : ''
    ]);

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A${startRow}:M${startRow + rows.length - 1}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers, body: JSON.stringify({ values: rows })
    });

    const endRow = startRow + rows.length - 1;
    const styleRequests = [];

    // Style header
    styleRequests.push({
      repeatCell: {
        range: { sheetId: tabSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 13 },
        cell: { userEnteredFormat: { backgroundColor: BLACK, textFormat: { bold: true, foregroundColor: ORANGE, fontSize: 11 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
      }
    });

    // Header row height
    styleRequests.push({ updateDimensionProperties: { range: { sheetId: tabSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });

    // Alternating row colors
    rows.forEach((_, i) => {
      const rowIndex = startRow - 1 + i;
      styleRequests.push({
        repeatCell: {
          range: { sheetId: tabSheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 13 },
          cell: { userEnteredFormat: { backgroundColor: i % 2 === 0 ? GREY_ROW : WHITE, verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,verticalAlignment)'
        }
      });
    });

    // Freeze header
    styleRequests.push({ updateSheetProperties: { properties: { sheetId: tabSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST', headers, body: JSON.stringify({ requests: styleRequests })
    });

    return res.status(200).json({ spreadsheetId: sheetId, tabName, added: receipts.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
