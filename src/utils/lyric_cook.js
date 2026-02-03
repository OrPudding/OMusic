// src/utils/lyric_cook.js
// raw -> cooked(v3) + cooked 判定
// 不依赖 this / UI / 系统模块

/**
 * ✅ 判定是否是 cooked 格式（v3+）
 * @param {any} obj
 * @returns {boolean}
 */
export function isCookedLyricFormat(obj) {
	if (!obj || typeof obj !== "object") return false;
	if (!(Number(obj.v) >= 3)) return false;
	if (!Array.isArray(obj.lines)) return false;

	// 允许空 lines，但如果非空，至少第一行要有 t/o 的正确类型
	if (obj.lines.length === 0) return true;

	const it = obj.lines[0];
	if (!it || typeof it !== "object") return false;
	if (typeof it.t !== "number") return false;
	if (typeof it.o !== "string") return false;

	return true;
}

/**
 * 解析 LRC 字符串为 [{time, text}]：
 * - 支持一行多个时间戳
 * - 过滤“只有时间戳没有正文”的空行
 * - 排序
 * - 兼容网易云脏数据：[mm:ss:xx]/[mm:ss:xxx]
 */
export function parseLyric(lrcString) {
	const src = typeof lrcString === "string" ? lrcString : "";
	const lines = src.split("\n");
	const result = [];

	// 支持：
	// [mm:ss] / [mm:ss.xx] / [mm:ss.xxx]
	// [mm:ss:xx] / [mm:ss:xxx]   (网易云脏数据)
	// 分钟 1~2 位（少数歌词会写 [0:12.34]）
	const timeRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (!raw) continue;

		timeRe.lastIndex = 0;
		const times = [];
		let m;

		while ((m = timeRe.exec(raw)) !== null) {
			const mm = parseInt(m[1], 10);
			const ss = parseInt(m[2], 10);
			const fracRaw = m[3]; // 可能 undefined

			if (!isFinite(mm) || !isFinite(ss)) continue;

			let ms = 0;
			if (fracRaw != null) {
				const frac = String(fracRaw);
				// 1位 => 100ms*?（.5 视为 500ms）
				// 2位 => *10ms（.85 => 850ms） 兼容 [00:01:50] == 1.50s
				// 3位 => 毫秒
				if (frac.length === 1) ms = parseInt(frac, 10) * 100;
				else if (frac.length === 2) ms = parseInt(frac, 10) * 10;
				else ms = parseInt(frac.slice(0, 3).padEnd(3, "0"), 10);

				if (!isFinite(ms)) ms = 0;
			}

			const t = mm * 60 + ss + ms / 1000;
			if (isFinite(t) && t >= 0) times.push(t);
		}

		if (!times.length) continue;

		// 去掉时间戳后的正文
		const text = raw.replace(timeRe, "").trim();

		// ✅ 关键：正文为空 -> 这行只是时间点标记，跳过
		if (!text) continue;

		for (let k = 0; k < times.length; k++) {
			result.push({ time: times[k], text });
		}
	}

	result.sort((a, b) => a.time - b.time);

	return result.length ? result : [{ time: 0, text: "暂无歌词" }];
}

function pickLyricUser(u) {
	if (!u || typeof u !== "object") return null;

	const uid = u.userid != null ? Number(u.userid) : null;
	const name = u.nickname != null ? String(u.nickname) : "";
	const uptime = u.uptime != null ? Number(u.uptime) : null;

	// uid=0 也可能有效，但一般 uid 和 name 至少有一个
	if ((!uid || uid <= 0) && !name) return null;

	return {
		uid: uid && uid > 0 ? uid : 0,
		name: name || "",
		uptime: isFinite(uptime) && uptime > 0 ? uptime : 0,
	};
}

/**
 * ✅ raw(旧/新接口) → cooked(v3)
 * @param {object|null} rawData - apiService.getLyricData 返回的对象（旧缓存也可能是它）
 * @param {string|number} songId
 * @returns {object} cooked
 */
export function cookLyricsFromRaw(rawData, songId) {
	const sid = String(songId);

	// rawData 可能为空/异常
	const raw = rawData && typeof rawData === "object" ? rawData : {};

	// ✅ 可选：部分接口会给这些标记
	// - nolyric: 真的没有歌词
	// - uncollected: 歌词未收录
	if (raw.nolyric) return makeFallbackCooked(sid, "该歌曲无歌词");
	if (raw.uncollected) return makeFallbackCooked(sid, "歌词未收录");

	// 1) 解析三种歌词
	const originalArr = raw?.lrc?.lyric ? parseLyric(raw.lrc.lyric) : null;
	const translationArr = raw?.tlyric?.lyric ? parseLyric(raw.tlyric.lyric) : null;
	const romajiArr = raw?.romalrc?.lyric ? parseLyric(raw.romalrc.lyric) : null;

	// 2) 推断 lyricType
	let type = "chinese";
	if (romajiArr && translationArr) type = "japanese";
	else if (romajiArr && !translationArr) type = "cantonese";
	else if (translationArr) type = "english";

	// 3) 对齐 translation/romaji（按 time.toFixed(3) 键）
	const createMap = (arr) => {
		if (!arr || !arr.length) return null;
		const m = new Map();
		for (let i = 0; i < arr.length; i++) {
			const it = arr[i];
			if (!it || typeof it.time !== "number") continue;
			const key = it.time.toFixed(3);
			const val = (it.text || "").trim();
			if (val) m.set(key, val);
		}
		return m.size ? m : null;
	};

	const transMap = createMap(translationArr);
	const romaMap = createMap(romajiArr);

	// 4) 生成 cooked lines（只存事实数据）
	let lines = [];
	if (originalArr && originalArr.length) {
		lines = originalArr
			.map((line) => {
				if (!line || typeof line.time !== "number") return null;

				const o = (line.text || "").trim();
				if (!o) return null;

				const key = line.time.toFixed(3);
				const out = { t: line.time, o };

				const tr = transMap ? transMap.get(key) : null;
				const ro = romaMap ? romaMap.get(key) : null;

				if (tr) out.tr = tr;
				if (ro) out.ro = ro;

				return out;
			})
			.filter(Boolean);
	}

	// ✅ 如果解析完仍为空，给“暂无歌词”
	if (!lines.length) {
		lines = [{ t: 0, o: "暂无歌词" }];
	}

	// 5) 贡献者（可选）
	const by = {
		lyric: pickLyricUser(raw.lyricUser),
		trans: pickLyricUser(raw.transUser),
	};

	// 6) 版本/标记
	return {
		v: 3,
		songId: sid,
		type,
		flags: {
			sgc: !!raw.sgc,
			sfy: !!raw.sfy,
			qfy: !!raw.qfy,
		},
		ver: {
			lrc: Number(raw?.lrc?.version) || 0,
			tlyric: Number(raw?.tlyric?.version) || 0,
			romalrc: Number(raw?.romalrc?.version) || 0,
		},
		by,
		lines,
	};
}

/**
 * 构造兜底 cooked（网络失败/坏文件时）
 * @param {string|number} songId
 * @param {string} message
 */
export function makeFallbackCooked(songId, message = "暂无歌词") {
	return {
		v: 3,
		songId: String(songId),
		type: "chinese",
		flags: { sgc: false, sfy: false, qfy: false },
		ver: { lrc: 0, tlyric: 0, romalrc: 0 },
		by: { lyric: null, trans: null },
		lines: [{ t: 0, o: String(message || "暂无歌词") }],
	};
}
