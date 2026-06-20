const API = '/api/youtube';

/* ─── UTILITIES ─── */
function fmtCount(n) {
  if (!n && n !== 0) return '0';
  n = Number(n);
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
  if (h) return h + ':' + String(mn).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return mn + ':' + String(s).padStart(2, '0');
}

function fmtDurationLong(d) {
  if (!d) return '';
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return d;
  const h = m[1] ? parseInt(m[1]) : 0;
  const mn = m[2] ? parseInt(m[2]) : 0;
  const s = m[3] ? parseInt(m[3]) : 0;
  let parts = [];
  if (h) parts.push(h + 'h');
  if (mn) parts.push(mn + 'm');
  if (s) parts.push(s + 's');
  return parts.join(' ') || '0s';
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  if (s < 31536000) return Math.floor(s / 2592000) + 'mo ago';
  return Math.floor(s / 31536000) + 'y ago';
}

function extractVideoId(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  let m;
  m = str.match(/(?:youtube\.com\/watch\?.*?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|m\.youtube\.com\/watch\?.*?v=)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^https?:\/\//.test(str)) return null;
  m = str.match(/^([a-zA-Z0-9_-]{11})$/);
  if (m) return m[1];
  return null;
}

function isValidVideoInput(str) {
  if (!str || typeof str !== 'string') return false;
  str = str.trim();
  if (str.length < 11) return false;
  if (/^https?:\/\/(www\.)?youtube\.com\/watch\?/.test(str)) return true;
  if (/^https?:\/\/youtu\.be\//.test(str)) return true;
  if (/^https?:\/\/(www\.)?youtube\.com\/shorts\//.test(str)) return true;
  if (/^https?:\/\/(www\.)?youtube\.com\/embed\//.test(str)) return true;
  if (/^https?:\/\/(www\.)?youtube\.com\/live\//.test(str)) return true;
  if (/^https?:\/\/m\.youtube\.com\/watch\?/.test(str)) return true;
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return true;
  return false;
}

function extractChannelId(str) {
  if (!str) return null;
  let m = str.match(/(?:youtube\.com\/channel\/|youtube\.com\/c\/|youtube\.com\/@)([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function apiCall(action, params) {
  const p = new URLSearchParams({ action, ...params });
  const r = await fetch(API + '?' + p.toString());
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'API error');
  return d;
}

function debounce(fn, ms) {
  let t;
  return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

function skeleton(count) {
  let h = '<div class="results-grid">';
  for (let i = 0; i < count; i++) {
    h += '<div class="video-card skeleton-card"><div class="sk-thumb"></div><div class="sk-body"><div class="sk-line w80"></div><div class="sk-line w60"></div><div class="sk-line w40"></div></div></div>';
  }
  return h + '</div>';
}

function errorHtml(msg) {
  return '<div class="error-msg"><div class="error-icon">&#9888;</div><p>' + msg + '</p></div>';
}

/* ─── NAVIGATION ─── */
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const navs = ['home', 'analyzer', 'channels', 'rising', 'trending'];
  const idx = navs.indexOf(name);
  document.querySelectorAll('nav a').forEach((a, i) => a.classList.toggle('active', i === idx));
  if (name === 'trending' && !document.getElementById('trendingResults').hasChildNodes()) loadTrending();
  if (name === 'rising') { const c = document.getElementById('risingResults'); if (!c.hasChildNodes()) risingSearch(); }
  closeMenu();
  window.scrollTo(0, 0);
}

function toggleMenu() {
  document.getElementById('mainNav').classList.toggle('open');
  document.getElementById('menuToggle').classList.toggle('active');
}
function closeMenu() {
  document.getElementById('mainNav').classList.remove('open');
  document.getElementById('menuToggle').classList.remove('active');
}
document.addEventListener('click', function(e) {
  const nav = document.getElementById('mainNav');
  const tog = document.getElementById('menuToggle');
  if (nav.classList.contains('open') && !nav.contains(e.target) && !tog.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeDetail(); closeMenu(); } });

/* ─── HOME ─── */
document.getElementById('heroSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') heroSearch(); });
function heroSearch() {
  const q = document.getElementById('heroSearchInput').value.trim();
  if (!q) return;
  if (isValidVideoInput(q)) {
    const vid = extractVideoId(q);
    if (vid) { openDetail(vid); return; }
  }
  const cid = extractChannelId(q);
  if (cid) { openChannelDetail(cid); return; }
  if (q.startsWith('@') || q.includes('youtube.com/channel/')) { openChannelDetail(q); return; }
  document.getElementById('analyzerInput').value = q;
  switchPage('analyzer');
  analyzeVideo();
}

/* ─── VIDEO ANALYZER ─── */
let analyzerDebounced = debounce(function() { analyzeVideo(); }, 300);
document.getElementById('analyzerInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') analyzeVideo(); });

async function analyzeVideo() {
  const input = document.getElementById('analyzerInput').value.trim();
  const container = document.getElementById('analyzerResult');
  if (!input) return;

  if (!isValidVideoInput(input)) {
    container.innerHTML = errorHtml('Please paste a valid YouTube video link or video ID.');
    return;
  }

  const vid = extractVideoId(input);
  if (!vid) {
    container.innerHTML = errorHtml('Please paste a valid YouTube video link or video ID.');
    return;
  }

  container.innerHTML = skeleton(1);
  try {
    const data = await apiCall('video', { id: vid });
    container.innerHTML = renderVideoAnalysis(data);
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
  }
}

function renderVideoAnalysis(data) {
  const v = data.video;
  const ch = data.channel;
  const s = v.snippet;
  const st = v.statistics || {};
  const cd = v.contentDetails || {};

  const views = Number(st.viewCount || 0);
  const likes = Number(st.likeCount || 0);
  const comments = Number(st.commentCount || 0);
  const duration = fmtDuration(cd.duration);
  const durationLong = fmtDurationLong(cd.duration);
  const published = new Date(s.publishedAt);
  const daysSince = Math.max(1, (Date.now() - published.getTime()) / 86400000);
  const viewsPerDay = Math.round(views / daysSince);
  const engagementRate = views > 0 ? (likes / views * 100) : 0;
  const commentRate = views > 0 ? (comments / views * 100) : 0;
  const tags = s.tags || [];
  const desc = s.description || '';
  const shortDesc = desc.length > 300 ? desc.slice(0, 300) : desc;
  const catId = s.categoryId || '';
  const catNames = { '1':'Film','2':'Autos','10':'Music','15':'Pets','17':'Sports','19':'Travel','20':'Gaming','22':'People','23':'Comedy','24':'Entertainment','25':'News','26':'Howto','27':'Education','28':'Science','29':'Nonprofits' };
  const catLabel = catNames[catId] || 'General';

  const cpmMap = { '1':[2,5],'2':[5,15],'10':[1,3],'17':[3,8],'20':[1,3],'22':[2,5],'23':[2,5],'24':[2,6],'25':[3,10],'26':[3,8],'27':[4,12],'28':[5,15] };
  const cpm = cpmMap[catId] || [1, 4];
  const estLow = (views / 1000) * cpm[0] * 0.45;
  const estHigh = (views / 1000) * cpm[1] * 0.55;

  let chHtml = '';
  if (ch) {
    const chSt = ch.statistics || {};
    const chAge = channelAgeLabel(ch.snippet?.publishedAt);
    chHtml = `
      <div class="analysis-card ch-overview">
        <div class="ch-header">
          <img src="${ch.snippet?.thumbnails?.default?.url || ''}" alt="" class="ch-avatar-lg">
          <div class="ch-header-info">
            <h3>${ch.snippet?.title || ''}</h3>
            <span class="ch-country">${ch.snippet?.country || 'N/A'}</span>
            ${chAge ? '<span class="channel-age ' + chAge.cls + '">' + chAge.label + '</span>' : ''}
          </div>
          <a href="https://youtube.com/channel/${ch.id}" target="_blank" class="btn-outline btn-sm">View Channel &rarr;</a>
        </div>
        <div class="ch-stats-row">
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(chSt.subscriberCount)}</span><span class="ch-stat-lbl">Subscribers</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(chSt.viewCount)}</span><span class="ch-stat-lbl">Total Views</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(chSt.videoCount)}</span><span class="ch-stat-lbl">Videos</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${ch.snippet?.publishedAt ? new Date(ch.snippet.publishedAt).toLocaleDateString() : 'N/A'}</span><span class="ch-stat-lbl">Created</span></div>
        </div>
        <div class="ch-similar-link" onclick="findSimilarChannels('${ch.id}', '${(ch.snippet?.title || '').replace(/'/g, "\\'")}')">
          Find similar channels &rarr;
        </div>
      </div>`;
  }

  return `
    <div class="analysis-layout">
      <div class="analysis-top">
        <div class="analysis-player">
          <iframe src="https://www.youtube.com/embed/${v.id}" allow="encrypted-media" allowfullscreen></iframe>
        </div>
        <div class="analysis-info">
          <h1>${s.title}</h1>
          <div class="analysis-meta-row">
            <a href="https://youtube.com/channel/${s.channelId}" target="_blank" class="meta-channel">
              <img src="${ch?.snippet?.thumbnails?.default?.url || ''}" alt="">
              <span>${s.channelTitle}</span>
            </a>
            <span class="meta-dot">&middot;</span>
            <span>${timeAgo(s.publishedAt)}</span>
            <span class="meta-dot">&middot;</span>
            <span>${catLabel}</span>
          </div>
          <div class="analysis-tags">
            <span class="atag atag-views">${fmtCount(views)} views</span>
            <span class="atag atag-likes">&#10084; ${fmtCount(likes)}</span>
            <span class="atag atag-comments">&#128172; ${fmtCount(comments)}</span>
            <span class="atag">${duration}</span>
          </div>
        </div>
      </div>

      ${chHtml}

      <div class="analysis-grid">
        <div class="analysis-card">
          <h4>Performance</h4>
          <div class="perf-grid">
            <div class="perf-item"><span class="perf-val">${fmtCount(viewsPerDay)}</span><span class="perf-lbl">Views / Day</span></div>
            <div class="perf-item"><span class="perf-val">${engagementRate.toFixed(2)}%</span><span class="perf-lbl">Engagement</span></div>
            <div class="perf-item"><span class="perf-val">${commentRate.toFixed(3)}%</span><span class="perf-lbl">Comment Rate</span></div>
            <div class="perf-item"><span class="perf-val">${fmtCount(Math.round(views / Math.max(1, daysSince / 7)))}</span><span class="perf-lbl">Views / Week</span></div>
          </div>
        </div>

        <div class="analysis-card">
          <h4>Revenue Estimate</h4>
          <div class="rev-display">
            <span class="rev-amount">$${estLow.toFixed(0)} &ndash; $${estHigh.toFixed(0)}</span>
            <span class="rev-note">est. earnings</span>
          </div>
          <div class="rev-details">
            <div class="rd-row"><span>Category</span><span>${catLabel}</span></div>
            <div class="rd-row"><span>CPM Range</span><span>$${cpm[0]} - $${cpm[1]}</span></div>
            <div class="rd-row"><span>Daily Avg</span><span>$${(estLow/daysSince).toFixed(2)} - $${(estHigh/daysSince).toFixed(2)}</span></div>
          </div>
          <p class="rev-disclaimer">Estimate based on category avg CPM. Actual varies by audience geo and ad format.</p>
        </div>

        <div class="analysis-card">
          <h4>Video Info</h4>
          <div class="info-grid">
            <div class="info-item"><span class="info-icon">&#128197;</span><span class="info-val">${published.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</span><span class="info-lbl">Published</span></div>
            <div class="info-item"><span class="info-icon">&#9202;</span><span class="info-val">${durationLong}</span><span class="info-lbl">${duration}</span></div>
            <div class="info-item"><span class="info-icon">&#127909;</span><span class="info-val">${(cd.definition || 'hd').toUpperCase()}</span><span class="info-lbl">Quality</span></div>
            <div class="info-item"><span class="info-icon">&#128221;</span><span class="info-val">${cd.caption === 'true' ? 'Yes' : 'No'}</span><span class="info-lbl">Captions</span></div>
          </div>
        </div>

        <div class="analysis-card analysis-card-full">
          <h4>Description</h4>
          <div class="desc-section">
            <div class="desc-preview" id="descPreview">
              <p>${shortDesc || 'No description available.'}</p>
              ${desc.length > 300 ? '<button class="show-more-btn" onclick="toggleDesc()">Show full description</button>' : ''}
            </div>
            <div class="desc-full" id="descFull" style="display:none">
              <p>${desc || 'No description available.'}</p>
              <button class="show-more-btn" onclick="toggleDesc()">Show less</button>
            </div>
          </div>
          ${tags.length ? '<div class="tags-section"><h5>Tags</h5><div class="tags-wrap">' + tags.slice(0, 20).map(t => '<span class="tag">' + t + '</span>').join('') + '</div></div>' : ''}
        </div>
      </div>

      <div id="similarChannelsSection"></div>
    </div>`;
}

function toggleDesc() {
  const p = document.getElementById('descPreview');
  const f = document.getElementById('descFull');
  if (p.style.display === 'none') { p.style.display = ''; f.style.display = 'none'; }
  else { p.style.display = 'none'; f.style.display = ''; }
}

function channelAgeLabel(date) {
  if (!date) return null;
  const days = (Date.now() - new Date(date).getTime()) / 86400000;
  if (days < 180) return { label: '< 6 months', cls: 'age-new' };
  if (days < 730) return { label: '1-2 years', cls: 'age-mid' };
  return { label: 'Established', cls: 'age-old' };
}

/* ─── SIMILAR CHANNELS ─── */
let currentSimilarQuery = '';
let similarPageToken = null;

function findSimilarChannels(channelId, channelName) {
  currentSimilarQuery = channelName;
  similarPageToken = null;
  const section = document.getElementById('similarChannelsSection');
  section.innerHTML = `
    <div class="analysis-card similar-section">
      <div class="similar-header">
        <h4>Similar Channels to "${channelName}"</h4>
        <div class="similar-filters">
          <input id="simMinSubs" type="number" placeholder="Min subs">
          <input id="simMaxSubs" type="number" placeholder="Max subs">
          <input id="simCountry" placeholder="Country">
          <select id="simSort">
            <option value="relevance">Relevance</option>
            <option value="subscribers">By Subscribers</option>
            <option value="views">By Views</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <button onclick="loadSimilarChannels()" class="btn-sm btn-primary">Filter</button>
        </div>
      </div>
      <div id="similarResults">${skeleton(6)}</div>
    </div>`;
  loadSimilarChannels();
}

async function loadSimilarChannels(pageToken) {
  const container = document.getElementById('similarResults');
  const minSubs = document.getElementById('simMinSubs')?.value || '';
  const maxSubs = document.getElementById('simMaxSubs')?.value || '';
  const country = document.getElementById('simCountry')?.value || '';
  const sort = document.getElementById('simSort')?.value || 'relevance';

  container.innerHTML = skeleton(6);
  try {
    const data = await apiCall('similar', { q: currentSimilarQuery, minSubs, maxSubs, country, sort, pageToken });
    if (!data.channels.length) { container.innerHTML = '<p class="no-results-text">No similar channels found. Try adjusting filters.</p>'; return; }
    container.innerHTML = renderSimilarChannels(data.channels) +
      (data.nextPageToken ? '<div class="pagination"><button onclick="loadSimilarChannels(\'' + data.nextPageToken + '\')">Load more &rarr;</button></div>' : '');
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
  }
}

function renderSimilarChannels(channels) {
  return '<div class="similar-grid">' + channels.map(ch => {
    const age = channelAgeLabel(ch.publishedAt);
    const reason = ch.subscribers > 100000 ? 'Established creator' : ch.subscribers > 10000 ? 'Growing channel' : 'Rising creator';
    return `
      <div class="similar-card">
        <img src="${ch.thumbnail}" alt="" class="similar-thumb">
        <div class="similar-info">
          <h5>${ch.title}</h5>
          <div class="similar-stats">
            <span>${fmtCount(ch.subscribers)} subs</span>
            <span>${fmtCount(ch.totalViews)} views</span>
            <span>${fmtCount(ch.totalVideos)} videos</span>
          </div>
          ${ch.country ? '<span class="similar-country">' + ch.country + '</span>' : ''}
          ${age ? '<span class="channel-age ' + age.cls + '">' + age.label + '</span>' : ''}
          <span class="similar-reason">${reason}</span>
        </div>
        <a href="https://youtube.com/channel/${ch.id}" target="_blank" class="btn-outline btn-sm">Visit &rarr;</a>
      </div>`;
  }).join('') + '</div>';
}

/* ─── CHANNEL EXPLORER ─── */
let channelSearchPageToken = null;

document.getElementById('channelSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchChannels(); });

async function searchChannels(pageToken) {
  const q = document.getElementById('channelSearchInput').value.trim();
  const container = document.getElementById('channelResults');
  if (!q) return;
  container.innerHTML = skeleton(6);
  try {
    const data = await apiCall('similar', {
      q, pageToken,
      minSubs: document.getElementById('filterMinSubs')?.value || '',
      maxSubs: document.getElementById('filterMaxSubs')?.value || '',
      country: document.getElementById('filterCountry')?.value || '',
      sort: document.getElementById('filterSort')?.value || 'relevance'
    });
    if (!data.channels.length) { container.innerHTML = '<p class="no-results-text">No channels found. Try different keywords.</p>'; return; }
    container.innerHTML = renderSimilarChannels(data.channels) +
      (data.nextPageToken ? '<div class="pagination"><button onclick="searchChannels(\'' + data.nextPageToken + '\')">Load more &rarr;</button></div>' : '');
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
  }
}

function applyChannelFilters() { searchChannels(); }

/* ─── CHANNEL DETAIL ─── */
async function openChannelDetail(channelIdOrHandle) {
  switchPage('analyzer');
  const container = document.getElementById('analyzerResult');
  container.innerHTML = skeleton(1);
  try {
    const data = await apiCall('channel', { id: channelIdOrHandle });
    container.innerHTML = renderChannelPage(data.channel);
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
  }
}

function renderChannelPage(ch) {
  const st = ch.statistics || {};
  const sn = ch.snippet || {};
  const age = channelAgeLabel(sn.publishedAt);
  return `
    <div class="analysis-layout">
      <div class="analysis-card ch-overview ch-full-banner">
        <div class="ch-header">
          <img src="${sn.thumbnails?.high?.url || sn.thumbnails?.default?.url || ''}" alt="" class="ch-avatar-xl">
          <div class="ch-header-info">
            <h2>${sn.title || ''}</h2>
            <p class="ch-description">${(sn.description || '').slice(0, 200)}</p>
            <div class="ch-meta-row">
              ${sn.country ? '<span class="ch-country">' + sn.country + '</span>' : ''}
              ${age ? '<span class="channel-age ' + age.cls + '">' + age.label + '</span>' : ''}
              <span>${sn.publishedAt ? 'Created ' + new Date(sn.publishedAt).toLocaleDateString() : ''}</span>
            </div>
          </div>
          <a href="https://youtube.com/channel/${ch.id}" target="_blank" class="btn-primary btn-sm">Open on YouTube &rarr;</a>
        </div>
        <div class="ch-stats-row ch-stats-lg">
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(st.subscriberCount)}</span><span class="ch-stat-lbl">Subscribers</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(st.viewCount)}</span><span class="ch-stat-lbl">Total Views</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${fmtCount(st.videoCount)}</span><span class="ch-stat-lbl">Videos</span></div>
          <div class="ch-stat"><span class="ch-stat-val">${st.videoCount > 0 ? fmtCount(Math.round(Number(st.viewCount) / Number(st.videoCount))) : '0'}</span><span class="ch-stat-lbl">Avg Views/Video</span></div>
        </div>
        <div class="ch-similar-link" onclick="findSimilarChannels('${ch.id}', '${(sn.title || '').replace(/'/g, "\\'")}')">
          Find similar channels &rarr;
        </div>
      </div>
      <div id="similarChannelsSection"></div>
    </div>`;
}

/* ─── RISING ─── */
let risingPeriod = 'week';
document.getElementById('risingInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') risingSearch(); });
document.getElementById('risingDur')?.addEventListener('change', () => risingSearch());

function setRisingPeriod(p) {
  risingPeriod = p;
  document.querySelectorAll('.rising-actions .pill-outline').forEach(b => b.classList.toggle('active', b.dataset.period === p));
  risingSearch();
}

async function risingSearch() {
  const q = document.getElementById('risingInput').value.trim();
  const dur = document.getElementById('risingDur').value;
  const container = document.getElementById('risingResults');
  const stats = document.getElementById('risingStats');
  container.innerHTML = skeleton(6);
  stats.textContent = 'Searching...';
  try {
    const now = new Date();
    if (risingPeriod === 'week') now.setDate(now.getDate() - 7);
    else if (risingPeriod === 'month') now.setMonth(now.getMonth() - 1);
    else if (risingPeriod === 'year') now.setFullYear(now.getFullYear() - 1);

    const params = { q: q || 'trending', type: 'video', order: 'viewCount', maxResults: 24 };
    if (risingPeriod !== 'all') params.publishedAfter = now.toISOString();
    if (dur) params.videoDuration = dur;

    const data = await apiCall('search', params);
    if (!data.items || !data.items.length) { container.innerHTML = '<p class="no-results-text">No rising videos found.</p>'; stats.textContent = ''; return; }

    const ids = data.items.map(i => i.id?.videoId).filter(Boolean);
    const videosData = await apiCall('videos', { ids: ids.join(',') });
    const videoMap = {};
    (videosData.items || []).forEach(v => videoMap[v.id] = v);

    container.innerHTML = '<div class="results-grid">' + data.items.map(item => {
      const vid = item.id?.videoId;
      const vs = videoMap[vid]?.statistics || {};
      return buildVideoCard(item, vs);
    }).join('') + '</div>';

    const periodLabel = { week: 'this week', month: 'this month', year: 'this year' }[risingPeriod] || '';
    stats.innerHTML = data.items.length + ' rising videos from ' + periodLabel + (q ? ' for "' + q + '"' : '');
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
    stats.textContent = '';
  }
}

/* ─── TRENDING ─── */
async function loadTrending() {
  const container = document.getElementById('trendingResults');
  const stats = document.getElementById('trendingStats');
  container.innerHTML = skeleton(6);
  try {
    const data = await apiCall('trending', { regionCode: 'US', maxResults: 24 });
    if (!data.items || !data.items.length) { container.innerHTML = '<p class="no-results-text">No trending available.</p>'; return; }
    container.innerHTML = data.items.map(item => buildVideoCard(item, item.statistics || {})).join('');
    stats.innerHTML = '<span>YouTube trending chart</span>';
  } catch (err) {
    container.innerHTML = errorHtml(err.message);
  }
}

/* ─── VIDEO CARD BUILDER ─── */
function buildVideoCard(item, stats) {
  const vid = item.id?.videoId || item.id;
  const sn = item.snippet || {};
  const thumb = sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || '';
  const views = stats.viewCount ? Number(stats.viewCount) : null;
  const likes = stats.likeCount ? Number(stats.likeCount) : null;

  return `
    <div class="video-card" onclick="openDetail('${vid}')">
      <div class="thumb-wrap">
        <img src="${thumb}" alt="" loading="lazy">
        <div class="thumb-overlay">
          ${views !== null ? '<span class="thumb-views">' + fmtCount(views) + '</span>' : ''}
        </div>
      </div>
      <div class="card-body">
        <h3>${sn.title || ''}</h3>
        <div class="card-channel">${sn.channelTitle || ''}</div>
        <div class="card-meta">
          <span>${timeAgo(sn.publishTime || sn.publishedAt)}</span>
          ${likes !== null ? '<span>&#10084; ' + fmtCount(likes) + '</span>' : ''}
        </div>
      </div>
    </div>`;
}

/* ─── VIDEO DETAIL OVERLAY ─── */
let detailVideoId = null;

function openDetail(videoId) {
  detailVideoId = videoId;
  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('detailBody').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading analytics...</p></div>';
  loadDetail(videoId);
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  document.body.style.overflow = '';
  detailVideoId = null;
}

function refreshDetail() {
  if (detailVideoId) {
    document.getElementById('detailBody').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Refreshing...</p></div>';
    loadDetail(detailVideoId);
  }
}

function openLink() {
  const val = document.getElementById('linkInput').value.trim();
  if (!val) return;
  if (!isValidVideoInput(val)) { alert('Please paste a valid YouTube video link or video ID.'); return; }
  const vid = extractVideoId(val);
  if (vid) { openDetail(vid); document.getElementById('linkInput').value = ''; }
  else { alert('Please paste a valid YouTube video link or video ID.'); }
}

async function loadDetail(videoId) {
  try {
    const data = await apiCall('video', { id: videoId });
    document.getElementById('detailBody').innerHTML = renderVideoAnalysis(data);
  } catch (err) {
    document.getElementById('detailBody').innerHTML = errorHtml(err.message);
  }
}
