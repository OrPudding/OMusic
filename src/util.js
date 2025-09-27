import file from '@system.file';
import fetch from '@system.fetch';
import request from '@system.request';
import prompt from '@system.prompt';
import network from '@system.network';

const FILE_PATHS = {
    musicDir: 'internal://files/music/',
    lyricDir: 'internal://files/lyrics/',
    playListFile: 'internal://files/play_list.json',
    downloadedSongsFile: 'internal://files/downloaded_songs.json',
    favoriteSongsFile: 'internal://files/favorite_songs.json',
    downloadStatusFile: 'internal://files/download_status.json',
};

const API_BASE_URL = 'https://163api.qijieya.cn';

const util = {
    // 文件路径常量
    FILE_PATHS,

    // =================================================================
    // 文件操作工具 (File Utilities )
    // =================================================================

    /**
     * 读取文本文件内容
     * @param {string} uri 文件URI
     * @param {string} defaultValue 默认值，如果文件不存在或读取失败则返回
     * @returns {Promise<string>}
     */
    async readTextFile(uri, defaultValue = '') {
        return new Promise(resolve => {
            file.readText({
                uri: uri,
                success: (data) => resolve(data.text || defaultValue),
                fail: () => resolve(defaultValue)
            });
        });
    },

    /**
     * 写入文本文件内容
     * @param {string} uri 文件URI
     * @param {string} text 写入的文本内容
     * @returns {Promise<void>}
     */
    async writeTextFile(uri, text) {
        return new Promise(resolve => {
            file.writeText({
                uri: uri,
                text: text,
                success: resolve,
                fail: resolve // 即使失败也继续，不阻塞主流程
            });
        });
    },

    /**
     * 确保目录存在
     * @param {string} uri 目录URI
     * @returns {Promise<void>}
     */
    async ensureDirExists(uri) {
        return new Promise(resolve => {
            file.mkdir({
                uri: uri,
                success: resolve,
                fail: resolve
            });
        });
    },

    /**
     * 删除文件
     * @param {string} uri 文件URI
     * @returns {Promise<void>}
     */
    async deleteFile(uri) {
        return new Promise((resolve, reject) => {
            file.delete({
                uri: uri,
                success: resolve,
                fail: (data, code) => {
                    // 301 表示文件不存在，视为成功删除
                    if (code === 301) {
                        resolve();
                    } else {
                        reject(new Error(`删除文件失败, code=${code}`));
                    }
                }
            });
        });
    },

    /**
     * 移动文件
     * @param {string} srcUri 源文件URI
     * @param {string} dstUri 目标文件URI
     * @returns {Promise<void>}
     */
    async moveFile(srcUri, dstUri) {
        return new Promise((resolve, reject) => {
            file.move({
                srcUri: srcUri,
                dstUri: dstUri,
                success: resolve,
                fail: (data, code) => reject(new Error(`移动文件失败, code=${code}`))
            });
        });
    },

    // =================================================================
    // 网络请求工具 (Network Utilities)
    // =================================================================

    /**
     * 获取歌曲播放URL
     * @param {string} songId 歌曲ID
     * @returns {Promise<{url: string, duration: number}|null>}
     */
    async getSongPlayUrl(songId) {
        try {
            const res = await fetch.fetch({ url: `${API_BASE_URL}/song/url/v1?id=${songId}&level=higher` });
            const songData = JSON.parse(res.data)?.data?.[0];
            return songData && songData.url ? { url: songData.url, duration: Math.floor(songData.time / 1000) } : null;
        } catch (e) {
            console.error("获取歌曲播放URL失败:", e);
            return null;
        }
    },

    /**
     * 获取歌词数据
     * @param {string} songId 歌曲ID
     * @returns {Promise<object|null>}
     */
    async getLyricData(songId) {
        try {
            const res = await fetch.fetch({ url: `${API_BASE_URL}/lyric?id=${songId}` });
            return JSON.parse(res.data) || null;
        } catch (e) {
            console.error("获取歌词数据失败:", e);
            return null;
        }
    },

    /**
     * 订阅网络状态变化
     * @param {Function} callback 回调函数，参数为 { type: 'wifi'|'4g'|'none' }
     */
    subscribeNetworkChanges(callback) {
        network.getType({ success: (data) => callback(data) });
        network.subscribe({ callback: (data) => callback(data) });
    },

    // =================================================================
    // 歌曲数据管理 (Song Data Management)
    // =================================================================

    /**
     * 加载歌曲列表 (播放列表, 下载列表等)
     * @param {string} fileUri 文件URI
     * @param {Array} defaultList 默认列表
     * @returns {Promise<Array>}
     */
    async loadSongList(fileUri, defaultList = []) {
        const text = await util.readTextFile(fileUri, '[]');
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error(`解析 ${fileUri} 失败:`, e);
            return defaultList;
        }
    },

    /**
     * 保存歌曲列表
     * @param {string} fileUri 文件URI
     * @param {Array} list 歌曲列表
     * @returns {Promise<void>}
     */
    async saveSongList(fileUri, list) {
        return util.writeTextFile(fileUri, JSON.stringify(list, null, 2));
    },

    /**
     * 加载歌曲映射 (已下载, 已收藏)
     * @param {string} fileUri 文件URI
     * @param {object} defaultMap 默认映射
     * @returns {Promise<object>}
     */
    async loadSongMap(fileUri, defaultMap = {}) {
        const text = await util.readTextFile(fileUri, '{}');
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error(`解析 ${fileUri} 失败:`, e);
            return defaultMap;
        }
    },

    /**
     * 保存歌曲映射
     * @param {string} fileUri 文件URI
     * @param {object} map 歌曲映射
     * @returns {Promise<void>}
     */
    async saveSongMap(fileUri, map) {
        return util.writeTextFile(fileUri, JSON.stringify(map, null, 2));
    },

    // =================================================================
    // UI 提示 (UI Prompts)
    // =================================================================

    /**
     * 显示Toast提示
     * @param {string} message 提示信息
     * @param {number} duration 持续时间 (ms)
     */
    showToast(message, duration = 1500) {
        prompt.showToast({ message, duration });
    },

    /**
     * 显示对话框
     * @param {object} options 对话框选项
     * @returns {Promise<number>} 用户点击的按钮索引
     */
    async showDialog(options) {
        return new Promise(resolve => {
            prompt.showDialog({
                ...options,
                success: (data) => resolve(data.index),
                fail: () => resolve(-1) // 失败时返回-1
            });
        });
    },

    // =================================================================
    // 辅助工具 (Helper Utilities)
    // =================================================================

    /**
     * 将秒数转换为时间字符串 (MM:SS 或 HH:MM:SS)
     * @param {number} second 秒数
     * @returns {string}
     */
    second2time(second) {
        if (isNaN(second) || second < 0) return "00:00";
        const sec = Math.floor(second % 60).toString().padStart(2, "0");
        const min = Math.floor((second / 60) % 60).toString().padStart(2, "0");
        const hour = Math.floor(second / 3600);
        return hour > 0 ? `${hour.toString().padStart(2, "0")}:${min}:${sec}` : `${min}:${sec}`;
    },
};

export default util;
