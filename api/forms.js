module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, companyName, action, formId, receipt } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Missing access token' });

  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // ACTION: create — builds the form and linked sheet
  if (action === 'create') {
    if (!companyName) return res.status(400).json({ error: 'Missing company name' });
    try {
      // Step 1: Create the Google Form
      const formRes = await fetch('https://forms.googleapis.com/v1/forms', {
        method: 'POST', headers,
        body: JSON.stringify({ info: { title: companyName + ' Expenses — Skrunchi', documentTitle: companyName + ' Expenses — Skrunchi' } })
      });
      const form = await formRes.json();
      if (form.error) return res.status(400).json({ error: form.error.message });
      const formId = form.formId;
      const formUrl = form.responderUri;

      // Step 2: Add all fields to the form
      const fields = [
        'Employee Name', 'Accounting Period', 'Date', 'Vendor',
        'Category', 'Subtotal', 'GST/HST', 'PST', 'Tip', 'Total',
        'Payment Method', 'Reimbursable or Company Card', 'Notes'
      ];
      const requests = fields.map((title, i) => ({
        createItem: {
          item: {
            title,
            questionItem: { question: { required: i < 6, textQuestion: { paragraph: false } } }
          },
          location: { index: i }
        }
      }));
      await fetch(`https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
        method: 'POST', headers, body: JSON.stringify({ requests })
      });

      // Step 3: Link to a Google Sheet
      const watchRes = await fetch(`https://forms.googleapis.com/v1/forms/${formId}/watches`, {
        method: 'POST', headers,
        body: JSON.stringify({ watch: { target: { topic: { topicName: 'projects/skrunchi/topics/responses' } }, eventType: 'RESPONSES' } })
      });

      // Step 4: Create the linked spreadsheet via Sheets API
      const sheetRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST', headers,
        body: JSON.stringify({ properties: { title: companyName + ' Expenses — Skrunchi' } })
      });
      const sheet = await sheetRes.json();
      if (sheet.error) return res.status(400).json({ error: sheet.error.message });
      const spreadsheetId = sheet.spreadsheetId;
      const sheetId = sheet.sheets[0].properties.sheetId;

      // Step 5: Write headers to the sheet
      const BLACK = { red: 0.067, green: 0.075, blue: 0.094 };
      const ORANGE = { red: 1, green: 0.482, blue: 0.208 };
      const headerRow = [['Employee', 'Accounting Period', 'Date', 'Vendor', 'Category', 'Subtotal', 'GST/HST', 'PST', 'Tip', 'Total', 'Payment Method', 'Reimbursable', 'Notes']];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:M1?valueInputOption=RAW`, {
        method: 'PUT', headers, body: JSON.stringify({ values: headerRow })
      });

      // Step 6: Style the header row
      const styleRequests = [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 13 },
            cell: { userEnteredFormat: { backgroundColor: BLACK, textFormat: { bold: true, foregroundColor: ORANGE, fontSize: 11 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
          }
        },
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
      ];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST', headers, body: JSON.stringify({ requests: styleRequests })
      });

      return res.status(200).json({ formId, formUrl, spreadsheetId });

    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ACTION: submit — submits a receipt to the form's linked sheet directly
  if (action === 'submit') {
    const { spreadsheetId, receipt, accountingPeriod } = req.body;
    if (!spreadsheetId || !receipt) return res.status(400).json({ error: 'Missing spreadsheetId or receipt' });
    try {
      // Get current row count for alternating colors
      const rangeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:A`, { headers });
      const rangeData = await rangeRes.json();
      const startRow = (rangeData.values || []).length + 1;

      const row = [[
        receipt.submittedBy || '',
        accountingPeriod || '',
        receipt.date || '',
        receipt.vendor || '',
        receipt.category || '',
        (receipt.subtotal || '').replace('$', ''),
        (receipt.gst_hst || '').replace('$', ''),
        (receipt.pst || '').replace('$', ''),
        (receipt.tip || '').replace('$', ''),
        (receipt.total || '').replace('$', ''),
        receipt.payment || '',
        receipt.reimbursable === false ? 'Company Card' : 'Reimbursable',
        receipt.notes || ''
      ]];

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A${startRow}:M${startRow}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST', headers, body: JSON.stringify({ values: row })
      });

      // Alternating row color
      const GREY = { red: 0.937, green: 0.937, blue: 0.937 };
      const WHITE = { red: 1, green: 1, blue: 1 };
      const rowIndex = startRow - 1;
      const colorRequests = [{
        repeatCell: {
          range: { sheetId: 0, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 13 },
          cell: { userEnteredFormat: { backgroundColor: rowIndex % 2 === 0 ? GREY : WHITE, verticalAlignment: 'MIDDLE' } },
          fields: 'userEnteredFormat(backgroundColor,verticalAlignment)'
        }
      }];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST', headers, body: JSON.stringify({ requests: colorRequests })
      });

      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ACTION: filter — applies a filter to the current accounting period
  if (action === 'filter') {
    const { spreadsheetId, accountingPeriod } = req.body;
    if (!spreadsheetId || !accountingPeriod) return res.status(400).json({ error: 'Missing params' });
    try {
      // Column B (index 1) is Accounting Period — apply a basic filter
      const filterRequests = [{
        setBasicFilter: {
          filter: {
            range: { sheetId: 0, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 13 },
            filterSpecs: [{
              columnIndex: 1,
              filterCriteria: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: accountingPeriod }] } }
            }]
          }
        }
      }];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST', headers, body: JSON.stringify({ requests: filterRequests })
      });
      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
