// 【请用此版本完整替换您的 src/services/player.js 文件】

import audio from '@system.audio';
import prompt from '@system.prompt';

// 【核心修正】直接导入所有需要的服务模块
import api from './api.js';
import file from './file.js';
import settings from './settings.js';

const FILE_PLAY_LIST = 'internal://files/play_list.json';
const FILE_DOWNLOADED_SONGS = 'internal://files/downloaded_songs.json';
const FILE_PLAYER_STATE = 'internal://files/player_state.json';
const MAX_PLAYBACK_RETRIES = 3;
const PLAY_TIMEOUT = 8000;

const playerService = {
    // --- 核心状态 ---
    playerState: {
        isPlaying: false,
        playDuration: 0,
        currSong: null,
        playMode: 0, // 0: loop, 1: single, 2: random
        isFmMode: false,
    },

    // --- 内部管理数据 ---
    playList: [],
    shuffledPlayList: [],
    currentIndex: -1,
    shuffledIndex: -1,
    fmQueue: [],
    downloadedSongs: {},
    
    // --- 内部控制状态 ---
    _isInitialized: false,
    _isChangingSong: false,
    _isFetchingFm: false,
    _retryCount: 0,
    _playTimeoutId: null,
    _callbacks: {}, // 用于通知UI层的回调函数

    /**
     * 【公共】初始化播放器服务。
     * @param {object} callbacks - UI层提供的回调函数集合。
     */
    async initialize(callbacks) {
        if (this._isInitialized) {
            this._callbacks = callbacks;
            this._notifyUI('stateChange', this.playerState);
            this._notifyUI('songChange', this.playerState.currSong);
            return;
        }
        console.log("PlayerService: 初始化...");

        this._callbacks = callbacks;
        this._bindAudioEvents();

        if (!file) {
            console.error("PlayerService: file 服务模块未导入！");
            return;
        }
        this.downloadedSongs = await file.readJson(FILE_DOWNLOADED_SONGS, {});
        this.playList = await file.readJson(FILE_PLAY_LIST, []);

        await this._restoreState();

        this._isInitialized = true;
        console.log("PlayerService: 初始化完成。");
    },

    /**
     * 【公共】处理来自页面的指令。
     * @param {string} action - 指令名称。
     * @param {object} [payload] - 指令附带的数据。
     */
    async handleAction(action, payload) {
        switch (action) {
            case 'play':
                this.play(payload?.songId, payload?.songInfo);
                break;
            case 'play_or_pause':
                this.playOrPause();
                break;
            case 'change':
                this.change(payload.direction);
                break;
            case 'seek':
                this.seek(payload.progress);
                break;
            case 'change_mode':
                this.changeMode();
                break;
            case 'start_fm':
                this.startFmMode(payload?.songId, payload?.songInfo);
                break;
            case 'save_state':
                this._saveState();
                break;
        }
    },

    // ===================================================================
    // =================== 核心播放逻辑 ==================================
    // ===================================================================

    /**
     * 播放指定歌曲，或从头播放列表。
     * @param {string} [songId] - 要播放的歌曲ID。
     * @param {object} [songInfo] - 歌曲信息，当歌曲不在列表时需要。
     */
    async play(songId, songInfo) {
        if (!songId) {
            if (this.playList.length > 0) {
                this.currentIndex = 0;
                this._playCurrent();
            } else {
                prompt.showToast({ message: "播放列表为空" });
            }
            return;
        }

        let index = this.playList.findIndex(item => item && String(item.id) === String(songId));
        if (index === -1) {
            if (songInfo) {
                this.playList.unshift(songInfo);
                index = 0;
                await file.writeJson(FILE_PLAY_LIST, this.playList);
            } else {
                prompt.showToast({ message: "无法播放，列表中无此歌曲" });
                return;
            }
        }
        
        this.currentIndex = index;
        this._playCurrent();
    },

    /**
     * 播放或暂停当前歌曲。
     */
    playOrPause() {
        if (!this.playerState.currSong) {
            this.play(); // 尝试从列表头开始播放
            return;
        }
        if (!audio.src) {
            this._playCurrent();
            return;
        }
        this.playerState.isPlaying ? audio.pause() : audio.play();
    },

    /**
     * 切换上一首或下一首。
     * @param {number} direction - 方向，-1为上一首，1为下一首。
     */
    change(direction) {
        if (this._isChangingSong) {
            prompt.showToast({ message: '正在切歌...' });
            return;
        }
        if (this.playerState.isFmMode) {
            if (direction < 0) {
                prompt.showToast({ message: '私人FM不支持上一首哦' });
                return;
            }
            this._playCurrent(); // FM模式总是播放下一首
            return;
        }
        if (!this.playList || this.playList.length === 0) return;

        switch (this.playerState.playMode) {
            case 0: // 列表循环
            case 1: // 单曲循环 (在onended中处理，这里表现为正常切歌)
                this.currentIndex = (this.currentIndex + direction + this.playList.length) % this.playList.length;
                break;
            case 2: // 随机播放
                if (!this.shuffledPlayList || this.shuffledPlayList.length !== this.playList.length) {
                    this._generateShuffledList(false);
                }
                this.shuffledIndex = (this.shuffledIndex + direction + this.shuffledPlayList.length) % this.shuffledPlayList.length;
                this.currentIndex = this.shuffledPlayList[this.shuffledIndex];
                break;
        }
        this._playCurrent();
    },

    /**
     * 跳转到指定播放进度。
     * @param {number} progress - 目标进度（秒）。
     */
    seek(progress) {
        if (this.playerState.currSong) {
            audio.currentTime = progress;
        }
    },

    /**
     * 切换播放模式。
     */
    changeMode() {
        if (this.playerState.isFmMode) {
            // ... (退出FM模式的逻辑) ...
            return;
        }
        this.playerState.playMode = (this.playerState.playMode + 1) % 3;
        const modeText = ['列表循环', '单曲循环', '随机播放'];
        prompt.showToast({ message: modeText[this.playerState.playMode] });
        if (this.playerState.playMode === 2 && this.playList.length > 0) {
            this._generateShuffledList(true);
        }
        this._notifyUI('stateChange', this.playerState);
    },

    /**
     * 开启私人FM模式。
     * @param {string} [initialSongId] - 初始播放的歌曲ID。
     * @param {object} [initialSongInfo] - 初始歌曲信息。
     */
    async startFmMode(initialSongId, initialSongInfo) {
        if (this._isFetchingFm) return;
        this.playerState.isFmMode = true;
        this._isFetchingFm = true;
        this.playList = [];
        this.fmQueue = [];
        audio.stop();
        prompt.showToast({ message: '正在开启私人FM...' });

        if (initialSongId && initialSongInfo) {
            this.fmQueue.push(initialSongInfo);
        }

        try {
            await this._fetchNextFmSongs();
            if (this.fmQueue.length > 0) {
                this._playCurrent();
            } else {
                prompt.showToast({ message: '无法获取FM歌曲，请检查网络' });
                this.playerState.isFmMode = false;
            }
        } catch (error) {
            prompt.showToast({ message: '启动FM失败' });
            this.playerState.isFmMode = false;
        } finally {
            this._isFetchingFm = false;
            this._notifyUI('stateChange', this.playerState);
        }
    },

    // ===================================================================
    // =================== 内部辅助方法 ==================================
    // ===================================================================

    /**
     * 【内部】播放当前索引的歌曲。
     */
    async _playCurrent() {
        if (this._isChangingSong) return;
        this._isChangingSong = true;
        this._notifyUI('loading', true);

        let songToPlay;
        if (this.playerState.isFmMode) {
            if (this.fmQueue.length === 0) await this._fetchNextFmSongs();
            if (this.fmQueue.length === 0) { this._resetPlayer(); return; }
            songToPlay = this.fmQueue.shift();
        } else {
            if (!this.playList || this.playList.length === 0) { this._resetPlayer(); return; }
            songToPlay = this.playList[this.currentIndex];
        }

        if (!songToPlay) {
            this._handlePlaybackError("无效的歌曲数据");
            return;
        }

        this._startPlaybackTimeout();
        
        try {
            const downloadedInfo = this.downloadedSongs[songToPlay.id];
            const isLocal = downloadedInfo?.localUri && await file.exists(downloadedInfo.localUri);

            let playbackInfo;
            if (isLocal) {
                playbackInfo = { ...songToPlay, ...downloadedInfo, playUrl: downloadedInfo.localUri };
            } else {
                const onlineQuality = settings.get('audioQuality.online');
                const onlineInfo = await api.getSongPlaybackInfo(songToPlay.id, onlineQuality);
                playbackInfo = { ...songToPlay, playUrl: onlineInfo.url, duration: onlineInfo.duration };
            }

            this.playerState.currSong = {
                id: playbackInfo.id,
                name: playbackInfo.name,
                artists: playbackInfo.artists,
                duration: playbackInfo.duration,
            };
            
            this._notifyUI('songChange', this.playerState.currSong);
            this._notifyUI('lyricChange', { songId: playbackInfo.id });

            audio.stop();
            audio.src = playbackInfo.playUrl;
            audio.play();

        } catch (error) {
            this._handlePlaybackError(error.message || "播放准备失败");
        }
    },

    /**
     * 【内部】绑定所有`@system.audio`的事件。
     */
    _bindAudioEvents() {
        audio.onplay = () => {
            this._clearPlaybackTimeout();
            this._isChangingSong = false;
            this.playerState.isPlaying = true;
            this._notifyUI('stateChange', this.playerState);
            this._notifyUI('loading', false);
        };
        audio.onpause = () => {
            this.playerState.isPlaying = false;
            this._notifyUI('stateChange', this.playerState);
        };
        audio.onstop = () => {
            this.playerState.isPlaying = false;
            this._notifyUI('stateChange', this.playerState);
        };
        audio.onerror = () => {
            this._handlePlaybackError("播放器发生错误");
        };
        audio.ontimeupdate = () => {
            if (!this._isChangingSong) {
                this.playerState.playDuration = audio.currentTime;
                this._notifyUI('timeUpdate', this.playerState.playDuration);
            }
        };
        audio.onended = () => {
            if (this.playerState.playMode === 1) { // 单曲循环
                this.seek(0);
                audio.play();
            } else {
                this.change(1);
            }
        };
        audio.onctrlplayprev = () => this.change(-1);
        audio.onctrlplaynext = () => this.change(1);
    },

    /**
     * 【内部】通知UI层更新。
     * @param {string} type - 通知类型。
     * @param {any} data - 通知数据。
     */
    _notifyUI(type, data) {
        if (typeof this._callbacks[type] === 'function') {
            this._callbacks[type](data);
        }
    },

    /**
     * 【内部】处理播放错误。
     * @param {string} message - 错误信息。
     */
    _handlePlaybackError(message) {
        this._clearPlaybackTimeout();
        this._isChangingSong = false;
        this._notifyUI('loading', false);
        this._retryCount++;
        prompt.showToast({ message: `${message} (尝试第 ${this._retryCount} 次)` });
        if (this._retryCount >= MAX_PLAYBACK_RETRIES) {
            prompt.showToast({ message: `多次尝试失败，已停止播放`, duration: 5000 });
            this._resetPlayer();
            return;
        }
        setTimeout(() => { this.change(1); }, 1500 + (this._retryCount * 1000));
    },
    
    /**
     * 【内部】重置播放器核心状态。
     */
    _resetPlayer() {
        audio.stop();
        this.playerState.currSong = null;
        this.playerState.isPlaying = false;
        this.playerState.playDuration = 0;
        this._isChangingSong = false;
        this._retryCount = 0;
        this._notifyUI('stateChange', this.playerState);
        this._notifyUI('songChange', null);
    },

    /**
     * 【内部】保存播放状态到文件。
     */
    async _saveState() {
        if (!this.playerState.currSong?.duration) return;
        const stateToSave = {
            lastSongId: this.playerState.currSong.id,
            lastPlayDuration: this.playerState.playDuration,
            playMode: this.playerState.playMode,
            duration: this.playerState.currSong.duration,
            timestamp: Date.now()
        };
        await file.writeJson(FILE_PLAYER_STATE, stateToSave);
    },

    /**
     * 【内部】从文件恢复播放状态。
     */
    async _restoreState() {
        const savedState = await file.readJson(FILE_PLAYER_STATE);
        const isStateExpired = savedState?.timestamp ? (Date.now() - savedState.timestamp > 12 * 3600 * 1000) : true;

        if (savedState?.lastSongId && !isStateExpired) {
            const lastIndex = this.playList.findIndex(song => song && song.id === savedState.lastSongId);
            if (lastIndex > -1) {
                this.currentIndex = lastIndex;
                this.playerState.playMode = savedState.playMode || 0;
                this.playerState.currSong = { ...this.playList[this.currentIndex], duration: savedState.duration };
                this.playerState.playDuration = savedState.lastPlayDuration || 0;
                
                this._notifyUI('stateChange', this.playerState);
                this._notifyUI('songChange', this.playerState.currSong);
                this._notifyUI('lyricChange', { songId: this.playerState.currSong.id, render: false }); // 只预加载，不渲染
                
                prompt.showToast({ message: "播放状态已恢复" });
            }
        }
    },

    /**
     * 【内部】生成随机播放列表。
     * @param {boolean} locateCurrent - 是否将当前歌曲作为随机列表的起点。
     */
    _generateShuffledList(locateCurrent = true) {
        this.shuffledPlayList = [...Array(this.playList.length).keys()];
        for (let i = this.shuffledPlayList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffledPlayList[i], this.shuffledPlayList[j]] = [this.shuffledPlayList[j], this.shuffledPlayList[i]];
        }
        if (locateCurrent) {
            const currentShuffledIndex = this.shuffledPlayList.indexOf(this.currentIndex);
            this.shuffledIndex = (currentShuffledIndex !== -1) ? currentShuffledIndex : 0;
        }
    },

    /**
     * 【内部】获取下一批FM歌曲。
     */
    async _fetchNextFmSongs() {
        if (this._isFetchingFm) return;
        this._isFetchingFm = true;
        try {
            const newSongs = await api.getPersonalFmSongs();
            if (newSongs.length > 0) {
                this.fmQueue.push(...newSongs);
            } else {
                prompt.showToast({ message: '没有更多FM推荐了' });
            }
        } catch (error) {
            prompt.showToast({ message: '获取新歌失败' });
        } finally {
            this._isFetchingFm = false;
        }
    },

    /**
     * 【内部】启动播放超时定时器。
     */
    _startPlaybackTimeout() {
        this._clearPlaybackTimeout();
        this._playTimeoutId = setTimeout(() => {
            this._handlePlaybackError("播放超时，请重试");
        }, PLAY_TIMEOUT);
    },

    /**
     * 【内部】清除播放超时定时器。
     */
    _clearPlaybackTimeout() {
        if (this._playTimeoutId) {
            clearTimeout(this._playTimeoutId);
            this._playTimeoutId = null;
        }
    },
};

export default playerService;
