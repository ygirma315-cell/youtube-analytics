const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}

function setCache(key, data) {
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function ytFetch(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, v);
  }
  const ck = url.toString();
  const cached_data = cached(ck);
  if (cached_data) return cached_data;
  const r = await fetch(ck);
  const d = await r.json();
  if (!r.ok) throw { status: r.status, ...d };
  setCache(ck, d);
  return d;
}

function json(res, code, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(code).json(data);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: { message: 'Method not allowed' } });
  if (!API_KEY) return json(res, 500, { error: { message: 'YouTube API key not configured' } });

  const { action } = req.query;

  try {
    if (action === 'video') {
      const { id } = req.query;
      if (!id) return json(res, 400, { error: { message: 'Missing video id' } });
      const [videos, captions] = await Promise.all([
        ytFetch('videos', { part: 'snippet,contentDetails,statistics', id }),
        ytFetch('captions', { part: 'snippet', videoId: id }).catch(() => ({ items: [] }))
      ]);
      if (!videos.items || !videos.items.length) return json(res, 404, { error: { message: 'Video not found' } });
      const v = videos.items[0];
      const ch = await ytFetch('channels', { part: 'snippet,statistics,contentDetails', id: v.snippet.channelId }).catch(() => null);
      return json(res, 200, { video: v, channel: ch && ch.items ? ch.items[0] : null, captions: captions.items || [] });
    }

    if (action === 'channel') {
      const { id } = req.query;
      if (!id) return json(res, 400, { error: { message: 'Missing channel id' } });
      const channels = await ytFetch('channels', { part: 'snippet,statistics,contentDetails', id });
      if (!channels.items || !channels.items.length) return json(res, 404, { error: { message: 'Channel not found' } });
      return json(res, 200, { channel: channels.items[0] });
    }

    if (action === 'similar') {
      const { q, minSubs, maxSubs, minViews, country, sort, pageToken } = req.query;
      if (!q) return json(res, 400, { error: { message: 'Missing search query' } });

      const searchParams = {
        part: 'snippet',
        q: q,
        type: 'channel',
        maxResults: 20,
        order: sort || 'relevance'
      };
      if (pageToken) searchParams.pageToken = pageToken;

      const search = await ytFetch('search', searchParams);
      if (!search.items || !search.items.length) return json(res, 200, { channels: [], nextPageToken: null });

      const chIds = search.items.map(i => i.id.channelId).filter(Boolean);
      if (!chIds.length) return json(res, 200, { channels: [], nextPageToken: null });

      const channelsData = await ytFetch('channels', {
        part: 'snippet,statistics,contentDetails',
        id: chIds.join(',')
      });

      let results = (channelsData.items || []).map(ch => {
        const st = ch.statistics || {};
        const sn = ch.snippet || {};
        return {
          id: ch.id,
          title: sn.title,
          description: (sn.description || '').slice(0, 200),
          thumbnail: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
          banner: sn.thumbnails?.default?.url || '',
          country: sn.country || '',
          publishedAt: sn.publishedAt,
          subscribers: Number(st.subscriberCount || 0),
          totalViews: Number(st.viewCount || 0),
          totalVideos: Number(st.videoCount || 0),
          hiddenSubs: st.hiddenSubscriberCount || false
        };
      });

      if (minSubs) results = results.filter(c => c.subscribers >= Number(minSubs));
      if (maxSubs) results = results.filter(c => c.subscribers <= Number(maxSubs));
      if (minViews) results = results.filter(c => c.totalViews >= Number(minViews));
      if (country) results = results.filter(c => c.country && c.country.toLowerCase() === country.toLowerCase());

      if (sort === 'subscribers') results.sort((a, b) => b.subscribers - a.subscribers);
      else if (sort === 'views') results.sort((a, b) => b.totalViews - a.totalViews);
      else if (sort === 'oldest') results.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
      else if (sort === 'newest') results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      return json(res, 200, { channels: results, nextPageToken: search.nextPageToken || null });
    }

    if (action === 'search') {
      const { q, type, order, maxResults, pageToken, publishedAfter, videoDuration } = req.query;
      if (!q) return json(res, 400, { error: { message: 'Missing query' } });
      const sp = { part: 'snippet', q, type: type || 'video', maxResults: maxResults || 24, order: order || 'relevance' };
      if (pageToken) sp.pageToken = pageToken;
      if (publishedAfter) sp.publishedAfter = publishedAfter;
      if (videoDuration) sp.videoDuration = videoDuration;
      const data = await ytFetch('search', sp);
      return json(res, 200, data);
    }

    if (action === 'videos') {
      const { ids } = req.query;
      if (!ids) return json(res, 400, { error: { message: 'Missing video ids' } });
      const data = await ytFetch('videos', { part: 'snippet,statistics', id: ids });
      return json(res, 200, data);
    }

    if (action === 'channels') {
      const { ids } = req.query;
      if (!ids) return json(res, 400, { error: { message: 'Missing channel ids' } });
      const data = await ytFetch('channels', { part: 'snippet,statistics,contentDetails', id: ids });
      return json(res, 200, data);
    }

    if (action === 'trending') {
      const { regionCode, maxResults } = req.query;
      const data = await ytFetch('videos', { part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: regionCode || 'US', maxResults: maxResults || 24 });
      return json(res, 200, data);
    }

    return json(res, 400, { error: { message: 'Invalid action' } });
  } catch (err) {
    const status = err.status || 500;
    const msg = err?.error?.message || err.message || 'Internal error';
    return json(res, status, { error: { message: msg } });
  }
}
