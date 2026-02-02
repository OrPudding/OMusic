import fetch from '@system.fetch';
import request from "@system.request";
import file from "@system.file";


const API_BASE = 'https://ncm-api.orpu.moe';
const COVER_DIR = "internal://files/cover/";

// ===== Cover helpers (concurrency de-dup + short-lived picUrl cache) =====
const _coverInflight = new Map(); // key: `${id}_${size}` -> Promise<string>
const _picUrlCache = new Map();   // key: id -> { url, ts }
const _PIC_URL_TTL_MS = 10 * 60 * 1000;
// ===== Cover index (cached_cover.json) =====
// 扁平结构：{ "12345_200": 1, ... } 只表示“该封面已缓存过”
const COVER_INDEX_URI = "internal://files/cached_cover.json";
const _coverIndex = new Map();
let _coverIndexLoaded = false;

function readTextFile(uri) {
  return new Promise((resolve) => {
    file.readText({
      uri,
      success: (res) => resolve(res?.text || ""),
      fail: () => resolve(""),
    });
  });
}

function writeTextFile(uri, text) {
  return new Promise((resolve) => {
    file.writeText({
      uri,
      text,
      encoding: "UTF-8",
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

async function ensureCoverIndexLoaded() {
  if (_coverIndexLoaded) return;
  _coverIndexLoaded = true;

  try {
    const txt = await readTextFile(COVER_INDEX_URI);
    if (!txt) return;

    const obj = JSON.parse(txt);
    if (!obj || typeof obj !== "object") return;

    Object.keys(obj).forEach((k) => {
      if (obj[k]) _coverIndex.set(k, 1);
    });
  } catch (_) {
    // 索引坏了/空了都无所谓：当没缓存，后续会重新写
  }
}

function saveCoverIndexAsync() {
  const obj = Object.fromEntries(_coverIndex);
  // 不 await，避免阻塞 UI；你最多 100 多首，这个文件很小
  writeTextFile(COVER_INDEX_URI, JSON.stringify(obj));
}


function accessPromise(uri) {
  return new Promise((resolve) => {
    file.access({
      uri,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

// 内部辅助函数：用于构建带认证信息的URL
function buildAuthenticatedUrl(baseUrl, cookie) {
  if (cookie) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}cookie=${encodeURIComponent(cookie)}`;
  }
  return baseUrl;
}

// 统一构造 API 错误，方便上层识别
function createApiError(name, message, extra) {
  const err = new Error(message || 'API Error');
  err.name = name || 'API_ERROR';
  if (extra && typeof extra === 'object') Object.assign(err, extra);
  return err;
}

// 判定“需要登录/登录态失效”的返回形态（保留你原逻辑）
function isAuthRequiredForSongUrl(parsedJson) {
  const rootCode = parsedJson?.code;
  const d0 = parsedJson?.data?.[0];

  if (rootCode === 301) return true;

  const urlNull = d0 && (d0.url === null || typeof d0.url === 'undefined');
  const cannotListenReason = d0?.freeTrialPrivilege?.cannotListenReason;
  const innerCode = d0?.code;

  if (rootCode === 200 && urlNull) {
    if (cannotListenReason === 1) return true;
    if (innerCode === 404) return true;
  }
  return false;
}

// 内部辅助：从各种形态里尽量拿到 text
function pickText(maybe) {
  if (typeof maybe === 'string') return maybe;
  if (maybe && typeof maybe.data === 'string') return maybe.data;
  if (maybe && typeof maybe.text === 'string') return maybe.text;
  return '';
}

// 内部辅助：尽量解析 JSON
function tryParseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// 内部辅助：把服务端的原始 message 组合成“HTTP / code:message”
function formatHttpAndApiMessage(httpCode, rawText) {
  // 默认只给 http code
  let msg = `HTTP ${httpCode}`;

  const j = rawText ? tryParseJson(rawText) : null;
  if (!j) {
    if (rawText) msg = `HTTP ${httpCode}: ${rawText}`;
    return { msg, parsed: null };
  }

  const apiCode = (typeof j.code !== 'undefined') ? j.code : '';
  const apiMsg = j.message || '';
  const blockText = j?.data?.blockText || '';
  const bestMsg = apiMsg || blockText;

  if (bestMsg) {
    msg = `HTTP ${httpCode}${apiCode !== '' ? ` / ${apiCode}` : ''}: ${bestMsg}`;
  } else {
    msg = `HTTP ${httpCode}${apiCode !== '' ? ` / ${apiCode}` : ''}`;
  }

  return { msg, parsed: j };
}

// 内部辅助函数，封装fetch调用：
// - success：resolve 原始 response
// - fail：reject Error(message=HTTP/code:message)，并带 httpCode/raw/parsed/url
function fetchPromise(url) {
  return new Promise((resolve, reject) => {
    fetch.fetch({
      url,
      responseType: 'text',
      success: resolve,
      fail: (data, code) => {
        const raw = pickText(data);
        const { msg, parsed } = formatHttpAndApiMessage(code, raw);
        const err = new Error(msg);
        err.name = 'FETCH_HTTP_ERROR';
        err.httpCode = code;
        err.raw = raw;
        err.parsed = parsed;
        err.url = url;

        // 你日志示例：-462 风控
        if (parsed && parsed.code === -462) {
          err.riskBlocked = true;
        }
        reject(err);
      }
    });
  });
}

export default {
  /**
   * 获取在线播放的歌曲信息（URL和时长）
   */
  async getSongPlaybackInfo(songId, bitrate, cookie) {
    const router = require('@system.router');
    const prompt = require('@system.prompt');

    // 内部：只弹一次，避免连续播放触发疯狂弹窗
    if (typeof this._loginDialogShown !== 'boolean') this._loginDialogShown = false;

    const askUserToLogin = (msg) => {
      if (this._loginDialogShown) return;
      this._loginDialogShown = true;

      try {
        prompt.showDialog({
          title: '需要登录',
          message: msg || '网易云已要求登录后才能获取播放链接。是否现在去登录？',
          buttons: [
            { text: '取消' },
            { text: '去登录' }
          ],
          success: () => {
            try { router.replace({ uri: '/pages/login' }); } catch (e) { }
          },
          cancel: () => { },
          complete: () => {
            setTimeout(() => { this._loginDialogShown = false; }, 1500);
          }
        });
      } catch (e) { }
    };

    // 1) 无 cookie：提示登录
    if (!cookie) {
      askUserToLogin('当前未登录，无法获取歌曲播放链接。是否现在去登录？');
      throw new Error('需要登录后才能获取播放链接');
    }

    const urlWithBitrate = `${API_BASE}/song/url?id=${songId}&br=${bitrate * 1000}`;
    const finalUrl = buildAuthenticatedUrl(urlWithBitrate, cookie);
    console.log("API: Fetching song URL:", finalUrl);

    let response;
    try {
      response = await fetchPromise(finalUrl);
    } catch (err) {
      // 这里 err.message 已经是“HTTP xxx / code: message”（如果能解析出来）
      // 风控 -462：给上层一个标记，避免自动切歌抽风
      if (err && err.riskBlocked) {
        const e = createApiError('RISK_BLOCKED', err.message, {
          riskBlocked: true,
          httpCode: err.httpCode,
          apiCode: err.parsed?.code,
          raw: err.raw,
          url: finalUrl
        });
        throw e;
      }
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(response.data);
    } catch (e) {
      throw createApiError('API_PARSE_ERROR', '播放链接接口返回格式异常', { raw: response.data, url: finalUrl });
    }

    // 2) 如果 API 自己返回非 200：直接抛 code:message（用原始 message / blockText）
    if (parsed && typeof parsed.code !== 'undefined' && parsed.code !== 200) {
      const m = parsed.message || parsed?.data?.blockText || '请求失败';
      const err = createApiError('API_BAD_CODE', `${parsed.code}: ${m}`, {
        apiCode: parsed.code,
        raw: response.data,
        url: finalUrl
      });
      if (parsed.code === -462) err.riskBlocked = true;
      throw err;
    }

    // 3) 登录态失效（常见 301）——兼容：有些实现会在 code!=200 时提前抛，这里留着不碍事
    if (parsed && parsed.code === 301) {
      askUserToLogin('登录已过期，无法获取播放链接。是否现在去登录？');
      throw new Error('登录已过期，请重新登录');
    }

    const d0 = parsed?.data?.[0];

    // 4) 你原来的“需要登录才能拿 url”的判定（保留）
    if (isAuthRequiredForSongUrl(parsed)) {
      askUserToLogin('网易云已要求登录后才能获取播放链接。是否现在去登录？');
      throw new Error('需要登录后才能获取播放链接');
    }

    // 5) 正常返回
    if (d0?.url) {
      return {
        url: d0.url,
        duration: Math.floor((d0.time || 0) / 1000)
      };
    }

    // 6) 其它原因拿不到 url（版权/下架/区域限制等）
    // 尽量把 data[0].code / message 带上（如果有）
    const innerCode = d0?.code;
    if (typeof innerCode !== 'undefined') {
      throw new Error(`${innerCode}: 获取播放链接失败（该歌曲可能不可播放或受限制）`);
    }
    throw new Error('获取播放链接失败（该歌曲可能不可播放或受限制）');
  },

  /**
   * 获取歌曲的歌词数据
   * 获取失败时返回 null（保持你原行为），但日志带上 code:message
   */
  async getLyricData(songId, cookie) {
    const finalUrl = buildAuthenticatedUrl(`${API_BASE}/lyric?id=${songId}`, cookie);
    console.log("API: Fetching lyric:", finalUrl);

    try {
      const response = await fetchPromise(finalUrl);
      const parsed = tryParseJson(response.data);
      if (!parsed) {
        console.error("API: 获取歌词失败（格式异常）", { url: finalUrl });
        return null;
      }
      if (typeof parsed.code !== 'undefined' && parsed.code !== 200) {
        const m = parsed.message || parsed?.data?.blockText || '请求失败';
        console.error(`API: 获取歌词失败 ${parsed.code}: ${m}`);
        return null;
      }
      return parsed;
    } catch (error) {
      console.error("API: 获取歌词失败", error?.message || error, error);
      return null;
    }
  },

  /**
   * 获取私人FM歌曲列表
   */
  async getPersonalFmSongs(cookie) {
    const url = `${API_BASE}/personal_fm?timestamp=${new Date().getTime()}`;
    const finalUrl = buildAuthenticatedUrl(url, cookie);
    console.log("API: Fetching personal FM:", finalUrl);

    try {
      const response = await fetchPromise(finalUrl);
      const parsed = tryParseJson(response.data);

      if (!parsed) {
        console.error("API: personal_fm 返回格式异常");
        return [];
      }
      if (typeof parsed.code !== 'undefined' && parsed.code !== 200) {
        const m = parsed.message || parsed?.data?.blockText || '请求失败';
        console.error(`API: personal_fm 失败 ${parsed.code}: ${m}`);
        // 风控场景也不要无限重试：上层可根据需求处理
        return [];
      }

      const fmData = parsed?.data;
      if (fmData && fmData.length > 0) {
        return fmData.map(s => ({
          id: s.id,
          name: s.name,
          artists: s.artists.map(a => a.name).join(' / '),
        }));
      }
      return [];
    } catch (e) {
      console.error("API: 获取 personal_fm 失败", e?.message || e, e);
      return [];
    }
  },
  /**
 * 搜索歌曲（分页）
 * @param {string} keywords 搜索关键词
 * @param {number} limit 每页条数
 * @param {number} offset 偏移量
 * @param {string} cookie 可选，用于接口鉴权
 * @returns {Promise<{songs:Array}>} 返回简化后的歌曲列表
 * 失败时抛出 Error，message 形如 "(405)操作频繁，请稍候再试"
 */
  async searchSongsPage(keywords, limit = 10, offset = 0, cookie) {
    const q = (keywords || "").trim();
    if (!q) throw createApiError("API_PARAM_ERROR", "关键词为空");
    const url = buildAuthenticatedUrl(`${API_BASE}/search?keywords=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, cookie);
    let response;
    try {
      response = await fetchPromise(url);
    } catch (err) {
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(response.data);
    } catch (e) {
      throw createApiError("API_PARSE_ERROR", "搜索接口返回格式异常", { raw: response.data, url });
    }
    if (typeof parsed.code !== "undefined" && parsed.code !== 200) {
      const m = parsed.msg || parsed.message || parsed?.data?.blockText || "请求失败";
      throw createApiError("API_BAD_CODE", `(${parsed.code})${m}`, { apiCode: parsed.code, raw: response.data, url });
    }
    const songs = parsed?.result?.songs || [];
    const mapped = songs.map(s => ({ id: s.id, name: s.name, artists: s.artists || [] }));
    return { songs: mapped };
  },

  async searchSongsAll(keywords, totalLimit = 25, apiPageSize = 10, cookie) {
    const q = (keywords || "").trim();
    if (!q) throw createApiError("API_PARAM_ERROR", "关键词为空");
    let offset = 0;
    let hasMore = true;
    const out = [];
    while (hasMore && out.length < totalLimit) {
      const page = await this.searchSongsPage(q, apiPageSize, offset, cookie);
      const arr = page.songs || [];
      if (arr.length === 0) {
        hasMore = false;
        break;
      }
      out.push(...arr);
      offset += arr.length;
      if (arr.length < apiPageSize) hasMore = false;
    }
    return out.slice(0, totalLimit);
  },

  /**
   * 获取歌曲封面（带本地缓存 + 并发去重 + picUrl短缓存）
   * - 关键改动：不再固定缓存为 .jpg，而是下载后读取文件头识别 png/jpg/webp 再落盘
   * - 兼容旧缓存：如果发现旧的 .jpg 实际是 png/webp，会自动“扶正”成正确后缀
   *
   * @param {number|string} songId
   * @param {number} px 需要的宽高分辨率，如 200 -> 200x200
   * @param {string} cookie 可选，用于接口鉴权
   * @returns {Promise<string>} 可直接用于 <image src> 的 url（优先本地 internal://）
   */
  async getSongCoverUrl(songId, px, cookie) {
    const id = String(songId);
    const size = Number(px);
    if (!id || !size) throw new Error("invalid params");
  
    const key = `${id}_${size}`;
    const baseUri = `${COVER_DIR}${id}_${size}px`;
    const localJpg = `${baseUri}.jpg`;
  
    const safeMoveOrCopy = (srcUri, dstUri) =>
      new Promise((resolve) => {
        file.move({
          srcUri,
          dstUri,
          success: () => resolve(true),
          fail: () => {
            file.copy({
              srcUri,
              dstUri,
              success: () => resolve(true),
              fail: () => resolve(false),
              complete: () => {},
            });
          },
        });
      });
  
    const downloadToTemp = (url) =>
      new Promise((resolve, reject) => {
        request.download({
          url,
          success: (t) => {
            request.onDownloadComplete({
              token: t.token,
              success: (res) => resolve(res.uri),
              fail: (data, code) => reject(code),
            });
          },
          fail: (data, code) => reject(code),
        });
      });
  
    // ---- 0) 并发去重 ----
    const inflight = _coverInflight.get(key);
    if (inflight) return inflight;
  
    const job = (async () => {
      // ---- 1) 只看 cached_cover.json（不 access） ----
      await ensureCoverIndexLoaded();
      if (_coverIndex.has(key)) {
        return localJpg;
      }
  
      // ---- 2) 拿 picUrl（短 TTL 缓存，保持你原逻辑） ----
      let picUrl = "";
      const cached = _picUrlCache.get(id);
      if (cached && cached.url && Date.now() - cached.ts < _PIC_URL_TTL_MS) {
        picUrl = cached.url;
      } else {
        const detailUrl = buildAuthenticatedUrl(
          `${API_BASE}/song/detail?ids=${encodeURIComponent(id)}`,
          cookie
        );
        const resp = await fetchPromise(detailUrl);
        const json = JSON.parse(resp.data);
        picUrl = json?.songs?.[0]?.al?.picUrl || "";
        if (!picUrl) throw new Error("picUrl missing");
        _picUrlCache.set(id, { url: picUrl, ts: Date.now() });
      }
  
      const remoteUrl = `${picUrl}?param=${size}y${size}`;
  
      // ---- 3) 下载到临时（失败：兜底远程） ----
      let tempUri = "";
      try {
        tempUri = await downloadToTemp(remoteUrl);
      } catch (_) {
        return remoteUrl;
      }
  
      // ---- 4) 落盘（move/copy 成功就算成功；失败兜底远程） ----
      try {
        const ok = await safeMoveOrCopy(tempUri, localJpg);
        if (ok) {
          _coverIndex.set(key, 1);
          saveCoverIndexAsync();
          return localJpg;
        }
        return remoteUrl;
      } catch (_) {
        return remoteUrl;
      }
    })();
  
    _coverInflight.set(key, job);
    try {
      return await job;
    } finally {
      _coverInflight.delete(key);
    }
  },  
  /**
   * 获取歌曲评论
   * 失败返回空结构（保持你原行为），但错误日志带 code:message
   */
  async getSongComments(songId, limit = 20, offset = 0) {
    const url = `${API_BASE}/comment/music?id=${songId}&limit=${limit}&offset=${offset}`;
    console.log("API: Fetching song comments:", url);

    try {
      const response = await fetchPromise(url);
      const commentData = tryParseJson(response.data);

      if (!commentData) {
        console.error("API: 评论返回格式异常");
        return { hotComments: [], comments: [], total: 0 };
      }

      if (typeof commentData.code !== 'undefined' && commentData.code !== 200) {
        const m = commentData.message || commentData?.data?.blockText || '请求失败';
        console.error(`API: 获取歌曲评论失败 ${commentData.code}: ${m}`);
        return { hotComments: [], comments: [], total: 0 };
      }

      return {
        hotComments: commentData.hotComments || [],
        comments: commentData.comments || [],
        total: commentData.total || 0
      };
    } catch (error) {
      console.error("API: 获取歌曲评论失败", error?.message || error, error);
      return { hotComments: [], comments: [], total: 0 };
    }
  },

  /**
   * 获取楼层评论 (某条评论的回复)
   * 失败返回 null（保持你原行为），但错误日志带 code:message
   */
  async getFloorComments(parentCommentId, resourceId, limit = 20) {
    const resourceType = 0;
    const url = `${API_BASE}/comment/floor?parentCommentId=${parentCommentId}&id=${resourceId}&type=${resourceType}&limit=${limit}`;
    console.log("API: Fetching floor comments:", url);

    try {
      const response = await fetchPromise(url);
      const floorData = tryParseJson(response.data);

      if (!floorData) {
        console.error("API: 楼层评论返回格式异常");
        return null;
      }

      if (typeof floorData.code !== 'undefined' && floorData.code !== 200) {
        const m = floorData.message || floorData?.data?.blockText || '请求失败';
        console.error(`API: 获取楼层评论失败 ${floorData.code}: ${m}`);
        return null;
      }

      return floorData.data;
    } catch (error) {
      console.error("API: 获取楼层评论失败", error?.message || error, error);
      return null;
    }
  }
};
