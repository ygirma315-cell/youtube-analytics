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
    const embeddable = cd.embeddable !== false;
    const tags = s.tags || [];
    const published = new Date(s.publishedAt);
    const pubDate = published.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const daysAgo = Math.floor((Date.now() - published.getTime()) / 86400000);
    const ageLabel = daysAgo === 0 ? 'Today' : daysAgo < 30 ? daysAgo + 'd ago' : daysAgo < 365 ? Math.floor(daysAgo / 30) + 'mo ago' : Math.floor(daysAgo / 365) + 'y ago';

    const embedUrl = 'https://www.youtube.com/embed/' + videoId;
    const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;

    const daysSince = Math.max(1, (Date.now() - published.getTime()) / 86400000);
    const viewsPerDay = Math.round(views / daysSince);
    const viewsPerHour = Math.round(views / Math.max(1, daysSince * 24));
    const engagementRate = views > 0 ? (likes / views * 100) : 0;
    const commentRate = views > 0 ? (comments / views * 100) : 0;
    const likeCommentRatio = comments > 0 ? (likes / comments) : 0;

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
      '1':'Film & Animation','2':'Autos & Vehicles','10':'Music','15':'Pets & Animals','17':'Sports',
      '18':'Short Movies','19':'Travel & Events','20':'Gaming','21':'Videoblogging',
      '22':'People & Blogs','23':'Comedy','24':'Entertainment','25':'News & Politics',
      '26':'Howto & Style','27':'Education','28':'Science & Technology','29':'Nonprofits & Activism',
      '30':'Movies','31':'Anime/Animation','32':'Action/Adventure','33':'Classics','34':'Comedy (Film)',
      '35':'Documentary','36':'Drama','37':'Family','38':'Foreign',
      '39':'Horror','40':'Sci-Fi/Fantasy','41':'Thriller','42':'Shorts',
      '43':'Shows','44':'Trailers'
    };
    var cpm = cpmRanges[catId] || [1, 4];
    var catLabel = catName[catId] || 'General';
    var rpmLow = cpm[0] * 0.45;
    var rpmHigh = cpm[1] * 0.55;
    var estLow = (views / 1000) * rpmLow;
    var estHigh = (views / 1000) * rpmHigh;
    var estDailyLow = estLow / daysSince;
    var estDailyHigh = estHigh / daysSince;
    var monthlyEstLow = estDailyLow * 30;
    var monthlyEstHigh = estDailyHigh * 30;
    var licensed = cd.licensedContent !== false;

    var subsPerVideo = ch.totalVideos > 0 ? Math.round(ch.subs / ch.totalVideos) : 0;
    var viewsPerSub = ch.subs > 0 ? (views / ch.subs) : 0;
    var subGrowthEst = ch.subs > 0 && daysSince > 0 ? Math.round((views * 0.02) / daysSince) : 0;

    var descLen = (s.description || '').length;
    var descWordCount = (s.description || '').split(/\s+/).filter(Boolean).length;
    var tagCount = tags.length;
    var hasLinks = (s.description || '').includes('http');
    var hasTimestamps = (s.description || '').match(/\d+:\d+/g);
    var titleLen = (s.title || '').length;

    var durationSec = 0;
    if (cd.duration) {
      var dm = cd.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (dm) durationSec = (parseInt(dm[1]||0)*3600) + (parseInt(dm[2]||0)*60) + parseInt(dm[3]||0);
    }

    var engagementGrade = engagementRate >= 8 ? 'A' : engagementRate >= 5 ? 'B' : engagementRate >= 3 ? 'C' : engagementRate >= 1 ? 'D' : 'F';
    var gradeColor = { A: '#00c853', B: '#66bb6a', C: '#ffc107', D: '#ff9800', F: '#ff5555' }[engagementGrade];

    var bestTime = '';
    var hour = published.getHours();
    if (hour >= 6 && hour < 9) bestTime = 'Morning (6-9am)';
    else if (hour >= 9 && hour < 12) bestTime = 'Late Morning (9am-12pm)';
    else if (hour >= 12 && hour < 15) bestTime = 'Afternoon (12-3pm)';
    else if (hour >= 15 && hour < 18) bestTime = 'Mid-Afternoon (3-6pm)';
    else if (hour >= 18 && hour < 21) bestTime = 'Evening (6-9pm)';
    else if (hour >= 21 || hour < 1) bestTime = 'Night (9pm-1am)';
    else bestTime = 'Late Night (1-6am)';

    var dayName = published.toLocaleDateString('en-US', { weekday: 'long' });

    var descLinks = (s.description || '').match(/https?:\/\/[^\s]+/g) || [];
    var hasSocialLinks = descLinks.some(function(l) {
      return l.match(/twitter|x\.com|instagram|tiktok|discord|patreon|paypal|donate|merch/i);
    });

    function miniBar(val, max, color) {
      var pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
      return '<div class="mini-bar"><div class="mini-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
    }

    function statBadge(val, label, color) {
      return '<div class="stat-badge" style="border-left:3px solid ' + color + '">' +
        '<span class="sb-val">' + val + '</span>' +
        '<span class="sb-lbl">' + label + '</span>' +
      '</div>';
    }

    document.getElementById('detailBody').innerHTML =
      '<div class="analytics-layout">' +

        '<div class="analytics-top">' +
          '<div class="analytics-player">' +
            '<iframe src="' + embedUrl + '" allow="encrypted-media" allowfullscreen></iframe>' +
          '</div>' +
          '<div class="analytics-top-info">' +
            '<h1>' + s.title + '</h1>' +
            '<div class="top-meta-row">' +
              '<a class="top-channel-link" href="' + watchUrl + '" target="_blank"><img src="' + (ch.avatar || '') + '" alt=""><span>' + s.channelTitle + '</span></a>' +
              '<span class="top-dot">&middot;</span>' +
              '<span>' + fmtCount(ch.subs) + ' subscribers</span>' +
              '<span class="top-dot">&middot;</span>' +
              '<span>' + ageLabel + '</span>' +
            '</div>' +
            '<div class="top-tag-row">' +
              '<span class="top-tag tag-' + (views >= 1000000 ? 'hot' : views >= 100000 ? 'warm' : 'cool') + '">' + fmtCount(views) + ' views</span>' +
              '<span class="top-tag tag-like">&#10084; ' + fmtCount(likes) + '</span>' +
              '<span class="top-tag tag-comment">&#128172; ' + fmtCount(comments) + '</span>' +
              '<span class="top-tag">' + duration + '</span>' +
              '<span class="top-tag">' + definition.toUpperCase() + '</span>' +
              (caption === 'true' ? '<span class="top-tag">CC</span>' : '') +
              (licensed ? '<span class="top-tag">Licensed</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="analytics-grid">' +

          '<div class="a-card a-engagement">' +
            '<h4>Engagement Score</h4>' +
            '<div class="engagement-display">' +
              '<div class="eng-grade" style="color:' + gradeColor + '">' + engagementGrade + '</div>' +
              '<div class="eng-details">' +
                '<div class="eng-rate">' + engagementRate.toFixed(2) + '% <span>like ratio</span></div>' +
                '<div class="eng-sub">' + commentRate.toFixed(3) + '% <span>comment ratio</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="eng-bars">' +
              '<div class="eng-bar-row"><span>Likes</span>' + miniBar(likes, views * 0.1, '#00c853') + '<span>' + fmtCount(likes) + '</span></div>' +
              '<div class="eng-bar-row"><span>Comments</span>' + miniBar(comments, views * 0.01, '#448aff') + '<span>' + fmtCount(comments) + '</span></div>' +
              '<div class="eng-bar-row"><span>Favorites</span>' + miniBar(favorites, views * 0.005, '#ff9800') + '<span>' + fmtCount(favorites) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-views">' +
            '<h4>View Analytics</h4>' +
            '<div class="view-numbers">' +
              '<div class="vn-big">' + fmtCount(views) + '</div>' +
              '<div class="vn-label">total views</div>' +
            '</div>' +
            '<div class="view-grid">' +
              '<div class="vg-item"><span class="vg-val">' + fmtCount(viewsPerDay) + '</span><span class="vg-lbl">/day</span></div>' +
              '<div class="vg-item"><span class="vg-val">' + fmtCount(viewsPerHour) + '</span><span class="vg-lbl">/hour</span></div>' +
              '<div class="vg-item"><span class="vg-val">' + daysSince + '</span><span class="vg-lbl">days old</span></div>' +
              '<div class="vg-item"><span class="vg-val">' + fmtCount(Math.round(views / Math.max(1, daysSince / 7))) + '</span><span class="vg-lbl">/week</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-revenue">' +
            '<h4>Revenue Estimate</h4>' +
            '<div class="rev-hero">' +
              '<div class="rev-range">$' + estLow.toFixed(0) + ' &ndash; $' + estHigh.toFixed(0) + '</div>' +
              '<div class="rev-label">estimated total earnings</div>' +
            '</div>' +
            '<div class="rev-grid">' +
              '<div class="rg-item"><span class="rg-val">$' + estDailyLow.toFixed(2) + ' &ndash; $' + estDailyHigh.toFixed(2) + '</span><span class="rg-lbl">daily avg</span></div>' +
              '<div class="rg-item"><span class="rg-val">$' + monthlyEstLow.toFixed(0) + ' &ndash; $' + monthlyEstHigh.toFixed(0) + '</span><span class="rg-lbl">monthly proj.</span></div>' +
            '</div>' +
            '<div class="rev-details">' +
              '<div class="row"><span class="lbl">Category</span><span class="val">' + catLabel + '</span></div>' +
              '<div class="row"><span class="lbl">Est. CPM</span><span class="val mono">$' + cpm[0] + ' &ndash; $' + cpm[1] + '</span></div>' +
              '<div class="row"><span class="lbl">RPM range</span><span class="val mono">$' + rpmLow.toFixed(2) + ' &ndash; $' + rpmHigh.toFixed(2) + '</span></div>' +
              '<div class="row"><span class="lbl">Licensed</span><span class="val ' + (licensed ? 'rev-yes' : 'rev-no') + '">' + (licensed ? 'Yes' : 'No') + '</span></div>' +
            '</div>' +
            '<div class="estimate-note">Based on category avg CPM &amp; YouTube\'s ~55% rev share. Actual varies by audience geo, ad format, seasonality.</div>' +
          '</div>' +

          '<div class="a-card a-channel">' +
            '<h4>Channel Insights</h4>' +
            '<div class="ch-hero">' +
              '<img src="' + (ch.avatar || '') + '" alt="" class="ch-hero-avatar">' +
              '<div>' +
                '<div class="ch-hero-name">' + s.channelTitle + '</div>' +
                (chAge ? '<div class="channel-age ' + chAge.cls + '">' + chAge.label + '</div>' : '') +
              '</div>' +
            '</div>' +
            '<div class="ch-grid">' +
              '<div class="cg-item"><span class="cg-val">' + fmtCount(ch.subs) + '</span><span class="cg-lbl">subscribers</span></div>' +
              '<div class="cg-item"><span class="cg-val">' + fmtCount(ch.totalViews) + '</span><span class="cg-lbl">total views</span></div>' +
              '<div class="cg-item"><span class="cg-val">' + fmtCount(ch.totalVideos) + '</span><span class="cg-lbl">videos</span></div>' +
              '<div class="cg-item"><span class="cg-val">' + fmtCount(subsPerVideo) + '</span><span class="cg-lbl">subs/video</span></div>' +
            '</div>' +
            '<div class="ch-extra">' +
              '<div class="row"><span class="lbl">Views per sub</span><span class="val">' + viewsPerSub.toFixed(1) + 'x</span></div>' +
              '<div class="row"><span class="lbl">This video share</span><span class="val">' + (ch.totalViews > 0 ? (views / ch.totalViews * 100).toFixed(1) : 0) + '% of total</span></div>' +
              '<div class="row"><span class="lbl">Avg views/video</span><span class="val">' + fmtCount(ch.totalVideos > 0 ? Math.round(ch.totalViews / ch.totalVideos) : 0) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-meta">' +
            '<h4>Video Metadata</h4>' +
            '<div class="meta-grid">' +
              '<div class="mg-item"><span class="mg-icon">&#128197;</span><span class="mg-val">' + pubDate + '</span><span class="mg-lbl">Published</span></div>' +
              '<div class="mg-item"><span class="mg-icon">&#9202;</span><span class="mg-val">' + duration + '</span><span class="mg-lbl">' + fmtDuration(cd.duration) + ' (' + durationSec + 's)</span></div>' +
              '<div class="mg-item"><span class="mg-icon">&#127909;</span><span class="mg-val">' + definition.toUpperCase() + '</span><span class="mg-lbl">Quality</span></div>' +
              '<div class="mg-item"><span class="mg-icon">&#128221;</span><span class="mg-val">' + (caption === 'true' ? 'Yes' : 'No') + '</span><span class="mg-lbl">Captions</span></div>' +
              '<div class="mg-item"><span class="mg-icon">&#128279;</span><span class="mg-val">' + embeddable ? 'Yes' : 'No' + '</span><span class="mg-lbl">Embeddable</span></div>' +
              '<div class="mg-item"><span class="mg-icon">&#128241;</span><span class="mg-val">' + catLabel + '</span><span class="mg-lbl">Category</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-timing">' +
            '<h4>Publishing Timing</h4>' +
            '<div class="timing-info">' +
              '<div class="ti-row"><span class="ti-icon">&#128336;</span><span class="ti-val">' + bestTime + '</span><span class="ti-lbl">Published at</span></div>' +
              '<div class="ti-row"><span class="ti-icon">&#128197;</span><span class="ti-val">' + dayName + '</span><span class="ti-lbl">Day of week</span></div>' +
              '<div class="ti-row"><span class="ti-icon">&#128200;</span><span class="ti-val">' + fmtCount(viewsPerDay) + ' views/day</span><span class="ti-lbl">Current velocity</span></div>' +
              '<div class="ti-row"><span class="ti-icon">&#128293;</span><span class="ti-val">' + (engagementRate >= 5 ? 'Viral potential' : engagementRate >= 2 ? 'Good momentum' : 'Steady growth') + '</span><span class="ti-lbl">Momentum</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-ratios">' +
            '<h4>Interaction Ratios</h4>' +
            '<div class="ratio-grid">' +
              '<div class="ratio-item">' +
                '<div class="ratio-val">' + (views > 0 ? (likes / views * 100).toFixed(2) : 0) + '%</div>' +
                '<div class="ratio-lbl">Like/View</div>' +
                '<div class="ratio-bar">' + miniBar(likes, views, '#00c853') + '</div>' +
              '</div>' +
              '<div class="ratio-item">' +
                '<div class="ratio-val">' + (views > 0 ? (comments / views * 100).toFixed(3) : 0) + '%</div>' +
                '<div class="ratio-lbl">Comment/View</div>' +
                '<div class="ratio-bar">' + miniBar(comments, views, '#448aff') + '</div>' +
              '</div>' +
              '<div class="ratio-item">' +
                '<div class="ratio-val">' + likeCommentRatio.toFixed(1) + '</div>' +
                '<div class="ratio-lbl">Like/Comment</div>' +
                '<div class="ratio-bar">' + miniBar(likes, Math.max(likes, comments), '#ff9800') + '</div>' +
              '</div>' +
              '<div class="ratio-item">' +
                '<div class="ratio-val">' + (ch.subs > 0 ? (views / ch.subs * 100).toFixed(1) : 0) + '%</div>' +
                '<div class="ratio-lbl">Views/Subs</div>' +
                '<div class="ratio-bar">' + miniBar(views, ch.subs, '#e040fb') + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="a-card a-seo">' +
            '<h4>SEO & Tags</h4>' +
            '<div class="seo-grid">' +
              '<div class="seo-item"><span class="seo-val">' + titleLen + '</span><span class="seo-lbl">Title chars</span><span class="seo-status ' + (titleLen >= 40 && titleLen <= 70 ? 'good' : 'warn') + '">' + (titleLen >= 40 && titleLen <= 70 ? 'Optimal' : titleLen < 40 ? 'Short' : 'Long') + '</span></div>' +
              '<div class="seo-item"><span class="seo-val">' + descLen + '</span><span class="seo-lbl">Desc chars</span><span class="seo-status ' + (descLen >= 200 ? 'good' : 'warn') + '">' + (descLen >= 200 ? 'Good' : 'Short') + '</span></div>' +
              '<div class="seo-item"><span class="seo-val">' + descWordCount + '</span><span class="seo-lbl">Desc words</span><span class="seo-status ' + (descWordCount >= 50 ? 'good' : 'warn') + '">' + (descWordCount >= 50 ? 'Detailed' : 'Brief') + '</span></div>' +
              '<div class="seo-item"><span class="seo-val">' + tagCount + '</span><span class="seo-lbl">Tags</span><span class="seo-status ' + (tagCount >= 5 ? 'good' : 'warn') + '">' + (tagCount >= 5 ? 'Good' : 'Few') + '</span></div>' +
              '<div class="seo-item"><span class="seo-val">' + (hasLinks ? descLinks.length : 0) + '</span><span class="seo-lbl">Links in desc</span><span class="seo-status ' + (hasLinks ? 'good' : '') + '">' + (hasLinks ? (hasSocialLinks ? 'Social + more' : 'Links found') : 'None') + '</span></div>' +
              '<div class="seo-item"><span class="seo-val">' + (hasTimestamps ? hasTimestamps.length : 0) + '</span><span class="seo-lbl">Timestamps</span><span class="seo-status ' + (hasTimestamps && hasTimestamps.length >= 3 ? 'good' : '') + '">' + (hasTimestamps ? 'Chaptered' : 'None') + '</span></div>' +
            '</div>' +
            (tags.length ? '<div class="seo-tags">' + tags.slice(0, 20).map(function(t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>' : '<div class="seo-tags seo-empty">No tags available</div>') +
          '</div>' +

          '<div class="a-card a-desc">' +
            '<h4>Description</h4>' +
            '<div class="desc-content"><p>' + (s.description || 'No description available.') + '</p></div>' +
            (descLinks.length ? '<div class="desc-links"><h5>Links in Description</h5>' + descLinks.slice(0, 10).map(function(l) { return '<a href="' + l + '" target="_blank" rel="noopener">' + l + '</a>'; }).join('') + '</div>' : '') +
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
