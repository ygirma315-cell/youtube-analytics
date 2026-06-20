const API_BASE = '/api/youtube';

function ytUrl(endpoint, params) {
  const p = new URLSearchParams(params);
  p.set('endpoint', endpoint);
  return API_BASE + '?' + p.toString();
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) { throw new Error('Server returned: ' + text.slice(0, 120)); }
}

/* ─── NAV ─── */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const idx = ['home','explore','rising','top','trending'].indexOf(name);
  document.querySelectorAll('nav a').forEach((a, i) => a.classList.toggle('active', i === idx));
  if (name === 'trending' && !document.getElementById('trendingResults').hasChildNodes()) fetchTrending();
  if (name === 'rising') { const c = document.getElementById('risingResults'); if (!c.hasChildNodes() || c.querySelector('.no-results')) risingSearch(); }
  if (name === 'top') {
    if (!topFormat) {
      document.getElementById('formatSelector').style.display = 'grid';
      document.getElementById('topFilterPanel').classList.remove('visible');
      document.getElementById('topStats').textContent = 'Choose a format above to get started.';
      document.getElementById('topResults').innerHTML = '';
    } else {
      const c = document.getElementById('topResults');
      if (!c.hasChildNodes() || c.querySelector('.no-results')) fetchTopToday();
    }
  }
  closeMenu();
}

/* ─── HOME ─── */
document.getElementById('heroSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') heroSearch(); });
function heroSearch() {
  const q = document.getElementById('heroSearchInput').value.trim();
  if (!q) return;
  var vid = extractVideoId(q);
  if (vid) {
    document.getElementById('exploreInput').value = q;
    switchPage('explore');
    openDetail(vid);
    return;
  }
  document.getElementById('exploreInput').value = q;
  switchPage('explore');
  exploreSearch();
}
function quickSearch(topic) {
  document.getElementById('exploreInput').value = topic;
  switchPage('explore');
  exploreSearch();
}

/* ─── YOUTUBE LINK PARSER ─── */
function extractVideoId(str) {
  if (!str) return null;
  var m;
  m = str.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = str.match(/^([a-zA-Z0-9_-]{11})$/);
  if (m) return m[1];
  return null;
}

/* ─── FORMATTERS ─── */
function fmtCount(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtDuration(d) {
  if (!d) return '';
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return d;
  const h = m[1] ? parseInt(m[1]) : 0;
  const mn = m[2] ? parseInt(m[2]) : 0;
  const s = m[3] ? parseInt(m[3]) : 0;
  if (h) return h + ':' + String(mn).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  return mn + ':' + String(s).padStart(2,'0');
}

function channelAgeLabel(createdAt) {
  if (!createdAt) return null;
  const age = Date.now() - new Date(createdAt).getTime();
  const days = age / 86400000;
  if (days < 180) return { label: '< 6 months old', cls: 'new' };
  if (days < 730) return { label: '1-2 years old', cls: 'established' };
  return { label: 'Established', cls: 'old' };
}

/* ─── CACHES ─── */
const channelCache = {};
const videoCache = {};

async function fetchChannels(channelIds) {
  const unique = [...new Set(channelIds.filter(id => id && !channelCache[id]))];
  if (!unique.length) return;
  for (let i = 0; i < unique.length; i += 50) {
    try {
      const res = await fetch(ytUrl('channels', { part: 'snippet,statistics', id: unique.slice(i, i + 50).join(',') }));
      if (!res.ok) continue;
      const data = await safeJson(res);
      if (data.items) data.items.forEach(ch => {
        channelCache[ch.id] = {
          subs: Number(ch.statistics?.subscriberCount || 0),
          totalViews: Number(ch.statistics?.viewCount || 0),
          totalVideos: Number(ch.statistics?.videoCount || 0),
          createdAt: ch.snippet?.publishedAt || null,
          avatar: ch.snippet?.thumbnails?.default?.url || '',
        };
      });
    } catch (_) {}
  }
}

async function fetchVideoStats(videoIds) {
  const unique = [...new Set(videoIds.filter(id => id && !videoCache[id]))];
  if (!unique.length) return;
  for (let i = 0; i < unique.length; i += 50) {
    try {
      const res = await fetch(ytUrl('videos', { part: 'statistics', id: unique.slice(i, i + 50).join(',') }));
      if (!res.ok) continue;
      const data = await safeJson(res);
      if (data.items) data.items.forEach(v => {
        videoCache[v.id] = videoCache[v.id] || {};
        Object.assign(videoCache[v.id], { statistics: v.statistics });
      });
    } catch (_) {}
  }
}

async function fetchFullVideo(videoId) {
  try {
    const res = await fetch(ytUrl('videos', { part: 'snippet,contentDetails,statistics', id: videoId }));
    if (!res.ok) { const e = await safeJson(res); throw new Error(e.error?.message || 'HTTP ' + res.status); }
    const data = await safeJson(res);
    if (data.items && data.items[0]) {
      videoCache[videoId] = videoCache[videoId] || {};
      Object.assign(videoCache[videoId], data.items[0]);
      return data.items[0];
    }
    throw new Error('Video not found');
  } catch (err) { throw err; }
}

/* ─── CARD BUILDER ─── */
function buildCard(item) {
  const videoId = item.id?.videoId || item.id;
  const snippet = item.snippet;
  const title = snippet.title;
  const channel = snippet.channelTitle;
  const channelId = snippet.channelId;
  const thumb = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '';
  const published = new Date(snippet.publishTime || snippet.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const ch = channelCache[channelId];
  const vs = videoCache[videoId]?.statistics;

  let subsHtml = '', avatarHtml = '', ageHtml = '';

  if (ch) {
    if (ch.subs > 0) subsHtml = '<div class="channel-subs">' + fmtCount(ch.subs) + ' subscribers</div>';
    if (ch.avatar) avatarHtml = '<div class="channel-avatar"><img src="' + ch.avatar + '" alt=""></div>';
    const age = channelAgeLabel(ch.createdAt);
    if (age) ageHtml = '<div class="channel-age ' + age.cls + '">' + age.label + '</div>';
  }

  const views = vs ? fmtCount(vs.viewCount) : '';
  const likes = vs ? fmtCount(vs.likeCount) : '';
  const overlayViews = views ? '<span class="views">' + views + ' views</span>' : '';

  const card = document.createElement('div');
  card.className = 'video-card';
  card.onclick = function() { openDetail(videoId); };
  card.innerHTML =
    '<div class="thumbnail-wrap">' +
      '<img src="' + thumb + '" alt="' + title.replace(/"/g, '&quot;') + '" loading="lazy">' +
      '<div class="thumbnail-overlay">' + overlayViews + '</div>' +
    '</div>' +
    '<div class="card-body">' +
      '<h3>' + title + '</h3>' +
      '<div class="channel-row">' +
        avatarHtml +
        '<div class="channel-info">' +
          '<div class="channel-name">' + channel + '</div>' +
          subsHtml +
        '</div>' +
      '</div>' +
      '<div class="meta">' +
        '<span>' + published + '</span>' +
        (likes ? '<span>&#10084; ' + likes + '</span>' : '') +
      '</div>' +
      ageHtml +
    '</div>';
  return card;
}

/* ─── VIDEO DETAIL ─── */
let detailVideoId = null;

function openDetail(videoId) {
  detailVideoId = videoId;
  document.getElementById('detailOverlay').classList.add('open');
  document.getElementById('detailBody').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading video details...</p></div>';
  loadDetail(videoId);
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  detailVideoId = null;
}

function refreshDetail() {
  if (detailVideoId) {
    delete videoCache[detailVideoId];
    document.getElementById('detailBody').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Refreshing analytics...</p></div>';
    loadDetail(detailVideoId);
  }
}

function openLink() {
  var input = document.getElementById('linkInput');
  var val = input.value.trim();
  if (!val) return;
  var vid = extractVideoId(val);
  if (vid) {
    openDetail(vid);
    input.value = '';
  } else {
    alert('Could not extract a YouTube video ID from that link.');
  }
}

async function loadDetail(videoId) {
  try {
    const video = await fetchFullVideo(videoId);
    const s = video.snippet;
    const st = video.statistics || {};
    const cd = video.contentDetails || {};

    if (s.channelId) await fetchChannels([s.channelId]);
    const ch = channelCache[s.channelId] || {};
    const chAge = channelAgeLabel(ch.createdAt);

    const views = Number(st.viewCount || 0);
    const likes = Number(st.likeCount || 0);
    const comments = Number(st.commentCount || 0);
    const favorites = Number(st.favoriteCount || 0);
    const duration = fmtDuration(cd.duration);
    const definition = cd.definition || 'hd';
    const caption = cd.caption || 'false';

    const tags = s.tags || [];
    const published = new Date(s.publishedAt);
    const pubDate = published.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const embedUrl = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1';
    const engagementRate = views > 0 ? ((likes / views) * 100).toFixed(2) + '%' : 'N/A';
    const daysSince = Math.max(1, (Date.now() - published.getTime()) / 86400000);
    const viewsPerDay = fmtCount(Math.round(views / daysSince));

    // Monetization estimation based on category
    var catId = s.categoryId || '0';
    var cpmRanges = {
      '1': [2,5], '2': [5,15], '10': [1,3], '15': [2,5], '17': [3,8],
      '18': [1,3], '19': [3,8], '20': [1,3], '21': [2,5], '22': [2,5],
      '23': [2,5], '24': [2,6], '25': [3,10], '26': [3,8], '27': [4,12],
      '28': [5,15], '29': [2,5], '30': [1,3], '31': [2,5], '32': [2,5],
      '33': [2,5], '34': [2,5], '35': [3,8], '36': [2,5], '37': [2,6],
      '38': [2,5], '39': [2,5], '40': [2,5], '41': [2,5], '42': [1,2],
      '43': [2,5], '44': [2,5]
    };
    var catName = {
      '1':'Film','2':'Autos','10':'Music','15':'Pets','17':'Sports',
      '18':'Short Movies','19':'Travel','20':'Gaming','21':'Videoblogging',
      '22':'People','23':'Comedy','24':'Entertainment','25':'News',
      '26':'Howto','27':'Education','28':'Science','29':'Nonprofits',
      '30':'Movies','31':'Anime','32':'Action','33':'Classics','34':'Comedy',
      '35':'Documentary','36':'Drama','37':'Family','38':'Foreign',
      '39':'Horror','40':'Sci-Fi','41':'Thriller','42':'Shorts',
      '43':'Shows','44':'Trailers'
    };
    var cpm = cpmRanges[catId] || [1, 4];
    var catLabel = catName[catId] || 'General';
    var rpmLow = cpm[0] * 0.45;
    var rpmHigh = cpm[1] * 0.55;
    var estLow = (views / 1000) * rpmLow;
    var estHigh = (views / 1000) * rpmHigh;
    var licensed = cd.licensedContent !== false;

    document.getElementById('detailBody').innerHTML =
      '<div class="detail-layout">' +
        '<div class="detail-main">' +
          '<div class="detail-player">' +
            '<iframe src="' + embedUrl + '" allow="autoplay; encrypted-media" allowfullscreen></iframe>' +
          '</div>' +
          '<div class="detail-info">' +
            '<h1>' + s.title + '</h1>' +
            '<div class="detail-meta">' +
              '<div class="stat-item"><span class="num">' + fmtCount(views) + '</span><span class="label">Views</span></div>' +
              '<div class="stat-item"><span class="num">' + fmtCount(likes) + '</span><span class="label">Likes</span></div>' +
              '<div class="stat-item"><span class="num">' + fmtCount(comments) + '</span><span class="label">Comments</span></div>' +
              '<div class="stat-item"><span class="num">' + duration + '</span><span class="label">Duration</span></div>' +
            '</div>' +
            '<div class="detail-channel">' +
              '<img src="' + (ch.avatar || '') + '" alt="">' +
              '<div class="ch-info">' +
                '<h3>' + s.channelTitle + '</h3>' +
                '<p>' + fmtCount(ch.subs) + ' subscribers &middot; ' + fmtCount(ch.totalViews) + ' total views &middot; ' + fmtCount(ch.totalVideos) + ' videos</p>' +
                (chAge ? '<div class="ch-age channel-age ' + chAge.cls + '">' + chAge.label + '</div>' : '') +
              '</div>' +
            '</div>' +
            (tags.length ? '<div class="detail-tags">' + tags.slice(0, 15).map(function(t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>' : '') +
            '<div class="detail-desc">' +
              '<h4>Description</h4>' +
              '<p>' + (s.description || 'No description.') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-sidebar">' +
          '<div class="stat-card">' +
            '<h4>Performance</h4>' +
            '<div class="row"><span class="lbl">Views per day</span><span class="val">' + viewsPerDay + '</span></div>' +
            '<div class="row"><span class="lbl">Engagement rate</span><span class="val">' + engagementRate + '</span></div>' +
            '<div class="row"><span class="lbl">Comments / 1K views</span><span class="val">' + (views > 0 ? (comments / views * 1000).toFixed(1) : 0) + '</span></div>' +
            '<div class="row"><span class="lbl">Favorites</span><span class="val">' + fmtCount(favorites) + '</span></div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<h4>Video Info</h4>' +
            '<div class="row"><span class="lbl">Published</span><span class="val">' + pubDate + '</span></div>' +
            '<div class="row"><span class="lbl">Duration</span><span class="val">' + duration + '</span></div>' +
            '<div class="row"><span class="lbl">Quality</span><span class="val">' + definition.toUpperCase() + '</span></div>' +
            '<div class="row"><span class="lbl">Captions</span><span class="val">' + (caption === 'true' ? 'Yes' : 'No') + '</span></div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<h4>Estimated Revenue</h4>' +
            '<div class="row"><span class="lbl">Category</span><span class="val">' + catLabel + '</span></div>' +
            '<div class="row"><span class="lbl">Est. CPM range</span><span class="val mono">$' + cpm[0] + ' - $' + cpm[1] + '</span></div>' +
            '<div class="row"><span class="lbl">Est. earnings</span><span class="val revenue-range">$' + estLow.toFixed(0) + ' - $' + estHigh.toFixed(0) + '</span></div>' +
            '<div class="row"><span class="lbl">Licensed content</span><span class="val ' + (licensed ? 'licensed-yes' : 'licensed-no') + '">' + (licensed ? 'Yes' : 'No') + '</span></div>' +
            '<div class="estimate-note">Rough estimate based on category avg CPM &amp; YouTube\'s 45-55% revenue share. Actual earnings vary widely.</div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<h4>Channel</h4>' +
            '<div class="row"><span class="lbl">Subscribers</span><span class="val">' + fmtCount(ch.subs) + '</span></div>' +
            '<div class="row"><span class="lbl">Total views</span><span class="val">' + fmtCount(ch.totalViews) + '</span></div>' +
            '<div class="row"><span class="lbl">Total videos</span><span class="val">' + fmtCount(ch.totalVideos) + '</span></div>' +
            '<div class="row"><span class="lbl">Created</span><span class="val">' + (ch.createdAt ? new Date(ch.createdAt).toLocaleDateString() : 'N/A') + '</span></div>' +
            (chAge ? '<div class="row"><span class="lbl">Channel age</span><span class="val channel-age ' + chAge.cls + '">' + chAge.label + '</span></div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (err) {
    document.getElementById('detailBody').innerHTML = '<div class="error-msg"><p>Could not load details</p><span>' + err.message + '</span></div>';
  }
}

/* ─── EXPLORE ─── */
let exploreNext = null, explorePrev = null;
document.getElementById('exploreInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') exploreSearch(); });

async function exploreSearch(pageToken) {
  const q = document.getElementById('exploreInput').value.trim();
  if (!q) return;
  var vid = extractVideoId(q);
  if (vid) { openDetail(vid); return; }
  const order = document.getElementById('exploreOrder').value;
  const time = document.getElementById('exploreTime').value;
  const dur = document.getElementById('exploreDur').value;

  const container = document.getElementById('exploreResults');
  const stats = document.getElementById('exploreStats');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Searching...</p></div>';
  stats.innerHTML = '';

  try {
    const prms = { part: 'snippet', q: q, type: 'video', maxResults: 24, order: order };
    if (pageToken) prms.pageToken = pageToken;
    const d = timeOffset(time); if (d) prms.publishedAfter = d.toISOString();
    if (dur) prms.videoDuration = dur;

    const res = await fetch(ytUrl('search', prms));
    if (!res.ok) { const e = await safeJson(res); throw new Error(e.error?.message || 'HTTP ' + res.status); }
    const data = await safeJson(res);
    exploreNext = data.nextPageToken || null;
    explorePrev = data.prevPageToken || null;

    if (!data.items || !data.items.length) {
      container.innerHTML = '<div class="no-results"><p>No results found</p><span>Try different keywords or filters.</span></div>';
      return;
    }

    const chIds = data.items.map(function(i) { return i.snippet && i.snippet.channelId; }).filter(Boolean);
    const vidIds = data.items.map(function(i) { return i.id && i.id.videoId; }).filter(Boolean);
    await Promise.all([fetchChannels(chIds), fetchVideoStats(vidIds)]);

    container.innerHTML = '<div class="results-grid"></div>';
    const grid = container.querySelector('.results-grid');
    data.items.forEach(function(item) { grid.appendChild(buildCard(item)); });

    const nav = document.createElement('div'); nav.className = 'pagination';
    if (explorePrev) { var b = document.createElement('button'); b.textContent = '\u2190 Previous'; b.onclick = function() { exploreSearch(explorePrev); }; nav.appendChild(b); }
    if (exploreNext) { var b = document.createElement('button'); b.textContent = 'Next \u2192'; b.onclick = function() { exploreSearch(exploreNext); }; nav.appendChild(b); }
    container.appendChild(nav);

    stats.innerHTML = '<span>Showing ' + data.items.length + ' results for "' + q + '"</span><button class="refresh-btn" onclick="exploreSearch()">Refresh</button>';
  } catch (err) {
    container.innerHTML = '<div class="error-msg"><p>Something went wrong</p><span>' + err.message + '</span></div>';
  }
}

/* ─── RISING ─── */
let risingPeriod = 'week';
document.getElementById('risingInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') risingSearch(); });
document.getElementById('risingDur').addEventListener('change', function() { risingSearch(); });

function setRisingPeriod(p) {
  risingPeriod = p;
  document.querySelectorAll('.rising-actions .pill-outline').forEach(function(b) { b.classList.toggle('active', b.dataset.period === p); });
  risingSearch();
}

async function risingSearch(pageToken) {
  const q = document.getElementById('risingInput').value.trim();
  const dur = document.getElementById('risingDur').value;
  const container = document.getElementById('risingResults');
  const stats = document.getElementById('risingStats');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Finding rising videos...</p></div>';
  stats.textContent = 'Scanning for videos with high engagement...';
  try {
    const prms = { part: 'snippet', type: 'video', maxResults: 24, order: 'viewCount' };
    if (q) prms.q = q;
    if (pageToken) prms.pageToken = pageToken;
    if (dur) prms.videoDuration = dur;
    const d = timeOffset(risingPeriod); if (d) prms.publishedAfter = d.toISOString();
    const res = await fetch(ytUrl('search', prms));
    if (!res.ok) { const e = await safeJson(res); throw new Error(e.error?.message || 'HTTP ' + res.status); }
    const data = await safeJson(res);
    if (!data.items || !data.items.length) {
      container.innerHTML = '<div class="no-results"><p>No rising videos found</p><span>Try a broader time range or niche.</span></div>';
      stats.textContent = ''; return;
    }
    const chIds = data.items.map(function(i) { return i.snippet && i.snippet.channelId; }).filter(Boolean);
    const vidIds = data.items.map(function(i) { return i.id && i.id.videoId; }).filter(Boolean);
    await Promise.all([fetchChannels(chIds), fetchVideoStats(vidIds)]);
    container.innerHTML = '<div class="results-grid"></div>';
    const grid = container.querySelector('.results-grid');
    data.items.forEach(function(item) {
      var card = buildCard(item);
      card.querySelector('.thumbnail-overlay').insertAdjacentHTML('beforeend', '<span class="badge">Rising</span>');
      grid.appendChild(card);
    });
    var next = data.nextPageToken || null;
    if (next) {
      var nav = document.createElement('div'); nav.className = 'pagination';
      var b = document.createElement('button'); b.textContent = 'Load more \u2192'; b.onclick = function() { risingSearch(next); };
      nav.appendChild(b); container.appendChild(nav);
    }
    var periodLabel = { week: 'this week', month: 'this month', year: 'this year' }[risingPeriod] || risingPeriod;
    stats.innerHTML = data.items.length + ' rising videos from ' + periodLabel + (q ? ' for "' + q + '"' : '') + '<button class="refresh-btn" onclick="risingSearch()">Refresh</button>';
  } catch (err) {
    container.innerHTML = '<div class="error-msg"><p>Something went wrong</p><span>' + err.message + '</span></div>';
    stats.textContent = '';
  }
}

/* ─── TOP TODAY ─── */
var topFormat = '';
var topCategory = 'all';
var topNiche = '';
var topPeriod = 'today';

var facelessNiches = [
  'Compilation', 'Gaming No Commentary', 'Stock Footage', 'Relaxation',
  'Animation', 'ASMR', 'Music', 'Lo-fi', 'Nature', 'Wildlife',
  'DIY Hands Only', 'Sports Highlights', 'Movie Recap', 'TV Recap',
  'Top 10 List', 'Trivia', 'Conspiracy', 'Data Visualization',
  'Meme Compilation', 'Car Videos', 'Travel Scenic', 'Animal Videos',
  'Tech No Face', 'Educational No Face', 'Cooking Hands Only',
  'Satisfying', 'Oddly Satisfying', 'Speed Paint', 'Ambient'
];

var withFaceNiches = [
  'Vlog', 'Lifestyle', 'Gaming With Cam', 'Commentary', 'Opinion',
  'Beauty', 'Makeup', 'Fashion', 'Fitness', 'Health',
  'Interview', 'Podcast', 'Reaction', 'Challenge',
  'Tutorial With Face', 'Review With Face', 'Unboxing',
  'Sketch Comedy', 'Storytime', 'Family Vlog', 'Travel Vlog With Face'
];

function selectFormat(format) {
  topFormat = format;
  document.getElementById('formatSelector').style.display = 'none';
  document.getElementById('topFilterPanel').classList.add('visible');
  document.getElementById('topStats').textContent = 'Pick a niche to see top ' + format + ' videos.';
  topCategory = 'all';
  topNiche = '';
  renderNiches();
  document.querySelectorAll('#categoryTabs .tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === 'all'); });
  // Set default duration filter based on format
  if (format === 'short') {
    document.getElementById('topDur').value = 'short';
  } else {
    document.getElementById('topDur').value = '';
  }
  fetchTopToday();
}

function renderNiches() {
  var container = document.getElementById('nicheScroll');
  container.innerHTML = '';
  var list = [];
  if (topCategory === 'all') {
    list = ['All'].concat(facelessNiches).concat(withFaceNiches);
  } else if (topCategory === 'faceless') {
    list = ['All'].concat(facelessNiches);
  } else {
    list = ['All'].concat(withFaceNiches);
  }
  list.forEach(function(n) {
    var btn = document.createElement('button');
    btn.className = 'niche-btn' + (n === topNiche || (n === 'All' && !topNiche) ? ' active' : '');
    btn.textContent = n;
    btn.onclick = function() { selectNiche(n); };
    container.appendChild(btn);
  });
  // Scroll "All" into view if active
  var active = container.querySelector('.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function setTopCategory(cat) {
  topCategory = cat;
  topNiche = '';
  document.querySelectorAll('#categoryTabs .tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === cat); });
  renderNiches();
  fetchTopToday();
}

function selectNiche(niche) {
  topNiche = (niche === 'All') ? '' : niche;
  document.querySelectorAll('#nicheScroll .niche-btn').forEach(function(b) { b.classList.toggle('active', b.textContent === niche); });
  fetchTopToday();
}

function setTopPeriod(period) {
  topPeriod = period;
  document.querySelectorAll('.time-pills .time-pill').forEach(function(b) { b.classList.toggle('active', b.dataset.period === period); });
  fetchTopToday();
}

document.getElementById('topDur').addEventListener('change', function() { fetchTopToday(); });

async function fetchTopToday() {
  if (!topFormat) return;
  var container = document.getElementById('topResults');
  var stats = document.getElementById('topStats');
  var dur = document.getElementById('topDur').value;
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading top videos...</p></div>';
  stats.textContent = 'Searching...';
  try {
    var prms = { part: 'snippet', type: 'video', maxResults: 20, order: 'viewCount' };
    var d = timeOffset(topPeriod); if (d) prms.publishedAfter = d.toISOString();
    if (topNiche) prms.q = topNiche;
    if (dur) prms.videoDuration = dur;
    if (topFormat === 'short' && !dur) prms.videoDuration = 'short';

    var res = await fetch(ytUrl('search', prms));
    if (!res.ok) { var e = await safeJson(res); throw new Error(e.error?.message || 'HTTP ' + res.status); }
    var data = await safeJson(res);
    if (!data.items || !data.items.length) {
      container.innerHTML = '<div class="no-results"><p>No videos found' + (topNiche ? ' for "' + topNiche + '"' : '') + '</p></div>';
      stats.textContent = ''; return;
    }
    var chIds = data.items.map(function(i) { return i.snippet && i.snippet.channelId; }).filter(Boolean);
    var vidIds = data.items.map(function(i) { return i.id && i.id.videoId; }).filter(Boolean);
    await Promise.all([fetchChannels(chIds), fetchVideoStats(vidIds)]);
    container.innerHTML = '<div class="results-grid"></div>';
    var grid = container.querySelector('.results-grid');
    data.items.forEach(function(item) {
      var card = buildCard(item);
      var idx = grid.children.length + 1;
      card.querySelector('.thumbnail-overlay').insertAdjacentHTML('beforeend', '<span class="badge">#' + idx + '</span>');
      grid.appendChild(card);
    });
    var periodLabel = { today: 'today', week: 'this week', month: 'this month', year: 'this year' }[topPeriod] || topPeriod;
    stats.innerHTML = 'Top ' + data.items.length + ' ' + topFormat + ' videos from ' + periodLabel + (topNiche ? ' in "' + topNiche + '"' : '') + '<button class="refresh-btn" onclick="fetchTopToday()">Refresh</button>';
  } catch (err) {
    container.innerHTML = '<div class="error-msg"><p>Could not load top videos</p><span>' + err.message + '</span></div>';
    stats.textContent = '';
  }
}

/* ─── TRENDING ─── */
async function fetchTrending() {
  const container = document.getElementById('trendingResults');
  const stats = document.getElementById('trendingStats');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading trending...</p></div>';
  try {
    const res = await fetch(ytUrl('videos', { part: 'snippet', chart: 'mostPopular', maxResults: 24, regionCode: 'US' }));
    if (!res.ok) { const e = await safeJson(res); throw new Error(e.error?.message || 'HTTP ' + res.status); }
    const data = await safeJson(res);
    container.innerHTML = '';
    if (!data.items || !data.items.length) { container.innerHTML = '<div class="no-results"><p>No trending available</p></div>'; return; }
    const chIds = data.items.map(function(i) { return i.snippet && i.snippet.channelId; }).filter(Boolean);
    const vidIds = data.items.map(function(i) { return i.id; }).filter(Boolean);
    await Promise.all([fetchChannels(chIds), fetchVideoStats(vidIds)]);
    data.items.forEach(function(item) { container.appendChild(buildCard(item)); });
    stats.innerHTML = '<span>YouTube\'s trending chart</span><button class="refresh-btn" onclick="fetchTrending()">Refresh</button>';
  } catch (err) {
    container.innerHTML = '<div style="grid-column:1/-1" class="error-msg"><p>Could not load trending</p><span>' + err.message + '</span></div>';
  }
}

/* ─── HELPERS ─── */
function timeOffset(key) {
  var now = new Date();
  switch (key) {
    case 'last1': now.setHours(now.getHours() - 1); return now;
    case 'today': now.setHours(0,0,0,0); return now;
    case 'week': now.setDate(now.getDate() - 7); return now;
    case 'month': now.setMonth(now.getMonth() - 1); return now;
    case 'year': now.setFullYear(now.getFullYear() - 1); return now;
    default: return null;
  }
}

/* ─── ESC TO CLOSE DETAIL ─── */
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeDetail(); closeMenu(); } });

function toggleMenu() {
  document.getElementById('mainNav').classList.toggle('open');
  document.getElementById('menuToggle').classList.toggle('active');
}

function closeMenu() {
  document.getElementById('mainNav').classList.remove('open');
  document.getElementById('menuToggle').classList.remove('active');
}

document.addEventListener('click', function(e) {
  var nav = document.getElementById('mainNav');
  var toggle = document.getElementById('menuToggle');
  if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) {
    closeMenu();
  }
});
