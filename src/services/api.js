// src/services/api.js

import fetch from '@system.fetch';

const API_BASE = 'https://163api.qijieya.cn';

// 内部辅助函数  ，用于构建带认证信息的URL
function buildAuthenticatedUrl(baseUrl, cookie) {
    if (cookie) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}cookie=${encodeURIComponent(cookie)}`;
    }
    return baseUrl;
}

// 内部辅助函数，封装fetch调用
function fetchPromise(url) {
    return new Promise((resolve, reject) => {
        fetch.fetch({
            url,
            responseType: 'text',
            success: resolve,
            fail: (data, code) => reject({ data, code })
        });
    });
}

export default {
    /**
     * 获取在线播放的歌曲信息（URL和时长）
     * @param {string} songId - 歌曲ID
     * @param {number} bitrate - 音质码率 (kbps)
     * @param {string} cookie - 用户认证Cookie
     * @returns {Promise<object>} - 包含 url 和 duration 的对象
     */
    async getSongPlaybackInfo(songId, bitrate, cookie) {
        const urlWithBitrate = `${API_BASE}/song/url?id=${songId}&br=${bitrate * 1000}`;
        const finalUrl = buildAuthenticatedUrl(urlWithBitrate, cookie);
        console.log("API: Fetching song URL:", finalUrl);

        const response = await fetchPromise(finalUrl);
        const songData = JSON.parse(response.data)?.data?.[0];

        if (songData?.url) {
            return {
                url: songData.url,
                duration: Math.floor(songData.time / 1000)
            };
        } else {
            throw new Error('获取播放链接失败');
        }
    },

    /**
     * 获取歌曲的歌词数据
     * @param {string} songId - 歌曲ID
     * @param {string} cookie - 用户认证Cookie
     * @returns {Promise<object>} - 完整的歌词API返回对象
     */
    async getLyricData(songId, cookie) {
        const finalUrl = buildAuthenticatedUrl(`${API_BASE}/lyric?id=${songId}`, cookie);
        console.log("API: Fetching lyric:", finalUrl);

        try {
            const response = await fetchPromise(finalUrl);
            return JSON.parse(response.data);
        } catch (error) {
            console.error("API: 获取歌词失败", error);
            return null; // 获取失败时返回null，不抛出错误
        }
    },

    /**
     * 获取私人FM歌曲列表
     * @param {string} cookie - 用户认证Cookie
     * @returns {Promise<Array>} - 格式化后的歌曲对象数组
     */
    async getPersonalFmSongs(cookie) {
        const url = `${API_BASE}/personal_fm?timestamp=${new Date().getTime()}`;
        const finalUrl = buildAuthenticatedUrl(url, cookie);
        console.log("API: Fetching personal FM");

        const response = await fetchPromise(finalUrl);
        const fmData = JSON.parse(response.data)?.data;

        if (fmData && fmData.length > 0) {
            return fmData.map(s => ({
                id: s.id,
                name: s.name,
                artists: s.artists.map(a => a.name).join(' / '),
                // ... 其他必要字段
            }));
        }
        return [];
    },

    /**
     * 【【【新增】】】
     * 获取歌曲的评论
     * @param {string} songId - 歌曲ID
     * @param {number} [limit=20] - 取出评论数量
     * @param {number} [offset=0] - 偏移数量，用于分页
     * @returns {Promise<object>} - 包含热门评论和最新评论的对象
     */
    async getSongComments(songId, limit = 20, offset = 0) {
        const url = `${API_BASE}/comment/music?id=${songId}&limit=${limit}&offset=${offset}`;
        console.log("API: Fetching song comments:", url);
        try {
            const response = await fetchPromise(url);
            const commentData = JSON.parse(response.data);
            // 成功时，返回一个包含热门和最新评论的结构化对象
            if (commentData.code === 200) {
                return {
                    hotComments: commentData.hotComments || [],
                    comments: commentData.comments || [],
                    total: commentData.total || 0
                };
            }
            // 如果API返回错误码，则抛出错误
            throw new Error(`API返回错误码: ${commentData.code}`);
        } catch (error) {
            console.error("API: 获取歌曲评论失败", error);
            // 统一返回一个空的结构，防止页面因null或undefined而出错
            return { hotComments: [], comments: [], total: 0 };
        }
    },

    /**
     * 【【【新增】】】
     * 获取楼层评论 (某条评论的回复)
     * @param {string} parentCommentId - 楼层评论ID
     * @param {string} resourceId - 资源ID (这里是歌曲ID)
     * @param {number} [limit=20] - 取出评论数量
     * @returns {Promise<object>} - 包含楼层评论数据的对象
     */
    async getFloorComments(parentCommentId, resourceId, limit = 20) {
        // 根据API文档，歌曲的 type 固定为 0
        const resourceType = 0;
        const url = `${API_BASE}/comment/floor?parentCommentId=${parentCommentId}&id=${resourceId}&type=${resourceType}&limit=${limit}`;
        console.log("API: Fetching floor comments:", url);
        try {
            const response = await fetchPromise(url);
            const floorData = JSON.parse(response.data);
            if (floorData.code === 200) {
                return floorData.data; // API直接返回 data 对象
            }
            throw new Error(`API返回错误码: ${floorData.code}`);
        } catch (error) {
            console.error("API: 获取楼层评论失败", error);
            return null; // 获取失败时返回null
        }
    }
};
