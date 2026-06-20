const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';

const ALLOWED_ENDPOINTS = ['search', 'videos', 'channels'];

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({ error: { message: 'YouTube API key not configured on server' } });
  }

  const { endpoint, ...params } = req.query;

  if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: { message: 'Invalid or missing endpoint. Allowed: ' + ALLOWED_ENDPOINTS.join(', ') } });
  }

  try {
    const url = new URL(`${YOUTUBE_BASE}/${endpoint}`);
    url.searchParams.set('key', YOUTUBE_API_KEY);

    for (const [key, value] of Object.entries(params)) {
      if (key !== 'endpoint' && value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString());
    let data;
    try {
      data = await response.json();
    } catch (_) {
      return res.status(502).json({ error: { message: 'YouTube API returned invalid response' } });
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: 'Failed to fetch from YouTube API' } });
  }
}
