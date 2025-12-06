// 【请用此版本完整替换您的 src/services/download.js 文件】

import request from '@system.request';
import prompt from '@system.prompt';
import screenKeep from '../utils/screenKeep.js';

// 【核心修正】直接导入所有需要的服务模块
import api from './api.js';
import file from './file.js';
import settings from './settings.js';

const DIR_MUSIC = 'internal://files/music/';
const DIR_LYRICS = 'internal://files/lyrics/';

const downloadManager = {
    queue: [],
    isProcessing: false,
    currentTask: null,

    /**
     * 【公共】初始化下载服务。
     */
    async initialize() {
        if (!file) {
            console.error("DownloadService: 初始化失败，file 服务模块未导入！");
            return;
        }
        try {
            await file.ensureDirExists(DIR_MUSIC);
            await file.ensureDirExists(DIR_LYRICS);
            console.log('下载管理器初始化完成');
        } catch (error) {
            console.error('下载目录创建失败:', error);
        }
    },

    /**
     * 【公共】添加下载任务。
     */
    addTask(song, callbacks) {
        if (this.currentTask?.id === song.id || this.queue.some(t => t.id === song.id)) {
            prompt.showToast({ message: `已在下载队列中` });
            return;
        }

        const task = {
            id: song.id,
            song: song,
            callbacks: callbacks || {},
            status: 'pending'
        };

        this.queue.push(task);
        prompt.showToast({ message: `已加入下载队列` });

        this._processQueue();
    },

    /**
     * 【内部】处理下载队列。
     */
    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        screenKeep.enable();
        console.log('开始处理下载队列，开启屏幕常亮');

        while (this.queue.length > 0) {
            const task = this.queue[0];
            this.currentTask = task;
            task.status = 'downloading';
            
            prompt.showToast({ message: `开始下载: ${task.song.name}` });
            task.callbacks.onStart?.(task.song);

            try {
                const downloadedInfo = await this._downloadSong(task);
                
                task.callbacks.onSuccess?.(downloadedInfo);
                prompt.showToast({ message: `${task.song.name} 下载成功` });

            } catch (error) {
                const errorMessage = error.message || '未知下载错误';
                prompt.showToast({ message: `下载失败: ${errorMessage}` });
                task.callbacks.onError?.(errorMessage);
                console.error(`下载失败 ${task.song.name}:`, errorMessage);
            } finally {
                task.callbacks.onFinish?.();
                this.queue.shift();
                this.currentTask = null;
                if (this.queue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        this.isProcessing = false;
        screenKeep.disable();
        console.log('下载队列处理完成，关闭屏幕常亮');
    },

    /**
     * 【内部】执行单首歌曲的下载流程。
     */
    async _downloadSong(task) {
        const { song } = task;
        
        if (!api || !file || !settings) {
            throw new Error("下载任务缺少必要的服务模块依赖");
        }

        const downloadBitrate = settings.get('audioQuality.download');
        const lyricFilePath = `${DIR_LYRICS}${song.id}.json`;
        const songFilePath = `${DIR_MUSIC}${song.id}.mp3`;

        const [songPlaybackInfo, lyricData] = await Promise.all([
            api.getSongPlaybackInfo(song.id, downloadBitrate),
            api.getLyricData(song.id)
        ]);

        if (!songPlaybackInfo?.url) {
            throw new Error('无法获取歌曲下载链接');
        }

        const [songResult, lyricResult] = await Promise.allSettled([
            this._downloadFile(songPlaybackInfo.url, songFilePath),
            file.writeJson(lyricFilePath, lyricData)
        ]);

        if (songResult.status === 'rejected') {
            throw songResult.reason;
        }
        if (lyricResult.status === 'rejected') {
            console.warn(`歌曲 ${song.name} 的歌词保存失败:`, lyricResult.reason.message);
        }

        return {
            ...song,
            localUri: songResult.value,
            localLyricUri: lyricData && lyricResult.status === 'fulfilled' ? lyricFilePath : null,
            duration: songPlaybackInfo.duration
        };
    },

    /**
     * 【内部】使用原生 request.download 下载文件。
     */
    _downloadFile(url, destinationUri) {
        return new Promise((resolve, reject) => {
            request.download({
                url: url,
                filename: destinationUri.replace('internal://files/', ''),
                success: (task) => {
                    task.on('complete', (data) => resolve(data.uri));
                    task.on('fail', (data, code) => reject({ message: `下载过程中失败, code: ${code}` }));
                },
                fail: (err, code) => reject({ message: `无法开始下载, code: ${code}` })
            });
        });
    },
    
    getQueue() {
        return [...this.queue];
    },

    getCurrentTask() {
        return this.currentTask;
    },

    clearQueue() {
        this.queue = [];
        console.log('下载队列已清空');
    }
};

export default downloadManager;
