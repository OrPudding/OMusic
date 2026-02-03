// src/services/download.js

import request from '@system.request';
import file from '@system.file';
import prompt from '@system.prompt';
import apiService from './api.js'; // 依赖 api.js
import brightness from '@system.brightness'; // 导入模块
import { cookLyricsFromRaw, isCookedLyricFormat } from '../utils/lyric_cook.js';


const DIR_MUSIC = 'internal://files/music/';
const DIR_LYRICS = 'internal://files/lyrics/';
const DIR_COVER = 'internal://files/cover/';

// 内部函数：写歌词文件
function saveLyricFile(path, data) {
    return new Promise((resolve, reject) => {
        if (!data) {
            resolve(); // 如果没有歌词数据，直接成功
            return;
        }
        file.writeText({
            uri: path,
            text: JSON.stringify(data),
            success: resolve,
            fail: (err, code) => reject({ message: `保存歌词失败, code: ${code}`, code })
        });
    });
}

// 内部函数：下载歌曲文件到最终位置
function downloadSongToDestination(url, destinationUri) {
    return new Promise((resolve, reject) => {
        prompt.showToast({ message: '已开始下载，请稍候...' });
        request.download({
            url: url,
            // 【核心修正】直接指定包含目录的最终文件名
            // 注意：filename 参数在这里期望的是不含协议头的文件路径
            filename: destinationUri.replace('internal://files/', ''),
            success: (task) => {
                request.onDownloadComplete({
                    token: task.token,
                    success: (data) => {
                        prompt.showToast({ message: '歌曲文件下载完成', duration: 500 });
                        resolve(data.uri); // 成功时返回最终的URI
                    },
                    fail: (err, code) => {
                        reject({ message: `下载任务失败, code: ${code}`, code });
                    },
                });
            },
            fail: (err, code) => {
                reject({ message: `无法开始下载, code: ${code}`, code });
            },
        });
    });
}

export default {
    /**
     * 【重要】此方法应在 app.ux 的 onCreate 中调用
     * 确保所有下载所需的目录都已存在
     */
    initialize() {
        return Promise.all([
            new Promise(resolve => file.mkdir({ uri: DIR_MUSIC, complete: resolve })),
            new Promise(resolve => file.mkdir({ uri: DIR_LYRICS, complete: resolve })),
            new Promise(resolve => file.mkdir({ uri: DIR_COVER, complete: resolve }))
        ]);
    },

    /**
     * 启动歌曲下载流程
     * @param {object} songToDownload - 要下载的歌曲对象
     * @param {object} dependencies - 依赖项，如 cookie 和音质设置
     * @param {object} callbacks - 用于状态更新的回调函数
     */
    async start(songToDownload, dependencies, callbacks) {
        const { cookie, downloadBitrate } = dependencies;
        const { onStart, onSuccess, onError, onFinish } = callbacks;

        // 【【【核心修改】】】安全地开启屏幕常亮
        if (brightness && typeof brightness.setKeepScreenOn === 'function') {
            try {
                brightness.setKeepScreenOn({ keepScreenOn: true });
                console.log(`开始下载 ${songToDownload.name}，开启屏幕常亮。`);
            } catch (e) {
                console.error("调用 setKeepScreenOn(true) 失败:", e);
            }
        } else {
            console.warn("brightness.setKeepScreenOn 方法不存在，跳过开启常亮。");
        }

        const lyricFilePath = `${DIR_LYRICS}${songToDownload.id}.json`;
        const songFilePath = `${DIR_MUSIC}${songToDownload.id}.mp3`;
        const coverFilePath = `${DIR_COVER}${songToDownload.id}_200px.jpg`;

        onStart(songToDownload);

        try {
            // 1. 并行获取歌曲、歌词、封面（封面失败不影响下载成功）
            const [songPlaybackInfo, lyricData, coverUrl] = await Promise.all([
                apiService.getSongPlaybackInfo(songToDownload.id, downloadBitrate, cookie),
                apiService.getLyricData(songToDownload.id, cookie),
                apiService.getSongCoverUrl(songToDownload.id, 96, cookie).catch(() => '')
            ]);

            if (!songPlaybackInfo?.url) {
                throw new Error('无法获取歌曲下载链接');
            }

            // 2. 并行下载歌曲和保存歌词
            const cookedLyric = lyricData ? cookLyricsFromRaw(lyricData, songToDownload.id) : null;

            await Promise.all([
              downloadSongToDestination(songPlaybackInfo.url, songFilePath),
              saveLyricFile(lyricFilePath, cookedLyric)
            ]);
            

            // 3. 构建最终的下载信息并通知成功
            const downloadedInfo = {
                ...songToDownload,
                localUri: songFilePath,
                localLyricUri: lyricData ? lyricFilePath : null,
                duration: songPlaybackInfo.duration,
                // 只持久化本地封面；远程兜底 URL 不写入下载记录
                coverUrl: (coverUrl && String(coverUrl).startsWith('internal://')) ? String(coverUrl) : null
            };
            onSuccess(downloadedInfo);

        } catch (error) {
            console.error("下载服务失败:", error);
            
            // 【核心修正】增强的错误清理逻辑
            // 无论错误发生在哪一步，都尝试删除所有可能已创建的文件
            file.delete({ uri: songFilePath });
            file.delete({ uri: lyricFilePath });
            file.delete({ uri: coverFilePath });

            // 向UI层报告更具体的错误信息
            onError(error.message || '下载过程中发生未知错误');

        } finally {
            // 【【【核心修改】】】安全地关闭屏幕常亮
            if (brightness && typeof brightness.setKeepScreenOn === 'function') {
                try {
                    brightness.setKeepScreenOn({ keepScreenOn: false });
                    console.log(`下载流程结束，关闭屏幕常亮。`);
                } catch (e) {
                    console.error("调用 setKeepScreenOn(false) 失败:", e);
                }
            } else {
                console.warn("brightness.setKeepScreenOn 方法不存在，跳过关闭常亮。");
            }
            
            // onFinish 仍然需要被调用
            onFinish(songToDownload); 
        }
    }
};
