module.exports = async function handler(req, res) {
  const { code } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.BASE_URL;
  const redirectUri = `${baseUrl}/api/callback`;

  if (!code) {
    return res.redirect(`${baseUrl}?error=no_code`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      return res.redirect(`${baseUrl}?error=${tokens.error}`);
    }

    // Pass tokens back to app via URL (stored in localStorage by the app)
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expires_in: tokens.expires_in || 3600
    });

    res.redirect(`${baseUrl}?google_auth=${encodeURIComponent(params.toString())}`);

  } catch (err) {
    res.redirect(`${baseUrl}?error=${encodeURIComponent(err.message)}`);
  }
}
