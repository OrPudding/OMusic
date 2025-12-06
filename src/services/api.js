// 【请用此版本完整替换您的 src/services/api.js 文件】

import fetch from '@system.fetch';

// 【核心修正】直接导入所有需要的服务模块
import file from './file.js';

const API_BASE = 'https://163api.qijieya.cn';
const COOKIE_FILE_URI = 'internal://files/cookie.txt';

const apiService = {
    _globalCookie: null,
    _isCookieLoaded: false,

    /**
     * 【内部核心】从文件加载Cookie到内存
     */
    async _loadCookie( ) {
        if (!file) {
            console.error("ApiService: _loadCookie 失败，file 服务模块未导入！");
            this._globalCookie = null;
            this._isCookieLoaded = true;
            return;
        }
        try {
            const cookieText = await file.readText(COOKIE_FILE_URI);
            if (cookieText && cookieText.trim().startsWith('MUSIC_U=')) {
                this._globalCookie = cookieText.trim();
                console.log("ApiService: 全局Cookie已从文件加载到内存。");
            } else {
                this._globalCookie = null;
            }
        } catch (error) {
            this._globalCookie = null;
            if (error.code !== 301) {
                console.error("ApiService: 加载Cookie时发生异常:", error);
            }
        }
        this._isCookieLoaded = true;
    },

    /**
     * 【内部核心】发送网络请求
     */
    async _sendRequest(options) {
        if (!this._isCookieLoaded) {
            await this._loadCookie();
        }
        
        const cookieForRequest = options.tempCookie || this._globalCookie;
        let url = options.url;
        if (cookieForRequest) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}cookie=${encodeURIComponent(cookieForRequest)}`;
        }

        try {
            const response = await new Promise((resolve, reject) => {
                fetch.fetch({
                    url,
                    method: options.method || 'GET',
                    responseType: 'text',
                    success: resolve,
                    fail: (data, code) => reject({ code, data }),
                });
            });

            if (response.code === 200) {
                return JSON.parse(response.data);
            }
            throw new Error(`网络错误, code: ${response.code}`);
        } catch (error) {
            console.error(`请求失败 ${options.url}:`, error);
            throw error;
        }
    },

    // ===================================================================
    // =================== 对外暴露的公共方法 ============================
    // ===================================================================

    /**
     * 【公共】初始化服务
     */
    async initialize() {
        await this._loadCookie();
        console.log("ApiService: 初始化完成。");
    },

    /**
     * 【公共】写入Cookie到文件，并更新内存状态
     */
    async writeCookie(cookieString) {
        if (!file) {
            throw new Error("ApiService: writeCookie 失败，file 服务模块未导入！");
        }
        try {
            await file.writeText(COOKIE_FILE_URI, cookieString);
            this._globalCookie = cookieString;
            console.log("ApiService: Cookie已成功写入文件并更新到内存。");
        } catch (error) {
            console.error("ApiService: 写入Cookie失败:", error);
            throw error;
        }
    },

    /**
     * 【公共】清除Cookie文件，并清空内存状态
     */
    async clearCookie() {
        if (!file) {
            throw new Error("ApiService: clearCookie 失败，file 服务模块未导入！");
        }
        try {
            await file.delete(COOKIE_FILE_URI);
            this._globalCookie = null;
            console.log("ApiService: Cookie文件已删除，内存状态已清空。");
        } catch (error) {
            console.error("ApiService: 清除Cookie失败:", error);
            throw error;
        }
    },

    // --- API方法 (所有这些方法都保持不变，因为它们都依赖于 _sendRequest) ---

    async getSongPlaybackInfo(songId, bitrate) {
        const url = `${API_BASE}/song/url?id=${songId}&br=${bitrate * 1000}`;
        const response = await this._sendRequest({ url });
        const songData = response?.data?.[0];
        if (songData?.url) {
            return {
                url: songData.url,
                duration: Math.floor(songData.time / 1000),
            };
        }
        throw new Error('获取播放链接失败');
    },

    async getLyricData(songId) {
        const url = `${API_BASE}/lyric?id=${songId}`;
        try {
            return await this._sendRequest({ url });
        } catch (error) {
            return null;
        }
    },

    async getPlaylistDetail(playlistId) {
        const url = `${API_BASE}/playlist/detail?id=${playlistId}`;
        return await this._sendRequest({ url });
    },

    async getPlaylistAllTracks(playlistId, limit, offset) {
        const url = `${API_BASE}/playlist/track/all?id=${playlistId}&limit=${limit}&offset=${offset}`;
        return await this._sendRequest({ url });
    },

    async getDailyRecommendSongs() {
        const url = `${API_BASE}/recommend/songs`;
        const response = await this._sendRequest({ url });
        return response?.data?.dailySongs || [];
    },

    async getPersonalFmSongs() {
        const url = `${API_BASE}/personal_fm?timestamp=${Date.now()}`;
        const response = await this._sendRequest({ url });
        const fmData = response?.data;
        if (fmData?.length > 0) {
            return fmData.map(s => ({
                id: s.id,
                name: s.name,
                artists: s.artists.map(a => a.name).join(' / '),
            }));
        }
        return [];
    },

    async getUserDetail(uid) {
        const url = `${API_BASE}/user/detail?uid=${uid}`;
        const response = await this._sendRequest({ url });
        if (response?.code !== 200) {
            throw new Error(response?.msg || '获取用户信息失败');
        }
        return response.profile;
    },
    
    async getSongComments(songId, limit = 20, offset = 0) {
        const url = `${API_BASE}/comment/music?id=${songId}&limit=${limit}&offset=${offset}`;
        try {
            const commentData = await this._sendRequest({ url });
            if (commentData.code === 200) {
                return {
                    hotComments: commentData.hotComments || [],
                    comments: commentData.comments || [],
                    total: commentData.total || 0
                };
            }
            throw new Error(`API返回错误码: ${commentData.code}`);
        } catch (error) {
            return { hotComments: [], comments: [], total: 0 };
        }
    },

    async getFloorComments(parentCommentId, resourceId, limit = 20) {
        const url = `${API_BASE}/comment/floor?parentCommentId=${parentCommentId}&id=${resourceId}&type=0&limit=${limit}`;
        try {
            const floorData = await this._sendRequest({ url });
            if (floorData.code === 200) {
                return floorData.data;
            }
            throw new Error(`API返回错误码: ${floorData.code}`);
        } catch (error) {
            return null;
        }
    }
};

export default apiService;
