// src/utils/lyric_cook.js
// 纯工具：raw -> cooked(v3)，以及 cooked 判定
// 不依赖 this，不依赖 UI，不依赖系统模块

/**
 * ✅ 判定是否是 cooked 格式（v3+）
 * @param {any} obj
 * @returns {boolean}
 */
export function isCookedLyricFormat(obj) {
	return (
		!!obj &&
		typeof obj === "object" &&
		obj.v >= 3 &&
		Array.isArray(obj.lines) &&
		// lines 最少要有 t/o 字段
		(obj.lines.length === 0 ||
			(obj.lines[0] &&
				typeof obj.lines[0].t === "number" &&
				typeof obj.lines[0].o === "string"))
	);
}

/**
 * 解析 LRC 字符串为 [{time, text}]：
 * - 支持一行多个时间戳
 * - 过滤“只有时间戳没有正文”的空行
 * - 排序
 */
export function parseLyric(lrcString) {
	const lines = (lrcString || "").split("\n");
	const result = [];

	// 支持：
	// [mm:ss] / [mm:ss.xx] / [mm:ss.xxx]
	// 以及网易云脏数据：[mm:ss:xx] / [mm:ss:xxx]
	// 分钟允许 1~2 位（少数歌词会写成 [0:12.34]）
	const timeRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

	for (const raw of lines) {
		if (!raw) continue;

		// 1) 抓取该行所有时间戳
		timeRe.lastIndex = 0;
		const times = [];
		let m;

		while ((m = timeRe.exec(raw)) !== null) {
			const mm = parseInt(m[1], 10);
			const ss = parseInt(m[2], 10);
			const fracRaw = m[3]; // 可能为 undefined（比如 [01:23]）

			let ms = 0;
			if (fracRaw != null) {
				// 1~3 位都兼容：
				// 1 位：.5  => 500ms
				// 2 位：.85 => 850ms（网易云 [00:01:50] 这种等价于 1.50s）
				// 3 位：.213=> 213ms
				const frac = String(fracRaw);
				if (frac.length === 1) ms = parseInt(frac, 10) * 100;
				else if (frac.length === 2) ms = parseInt(frac, 10) * 10;
				else ms = parseInt(frac.slice(0, 3).padEnd(3, "0"), 10);
			}

			const t = mm * 60 + ss + ms / 1000;
			times.push(t);
		}

		if (!times.length) continue;

		// 2) 去掉该行所有时间戳后的“正文”
		const text = raw.replace(timeRe, "").trim();

		// ✅ 关键：正文为空，说明只是时间点标记，跳过
		if (!text) continue;

		// 3) 一行多个时间戳：同一句在多个时间点出现，都入结果
		for (const t of times) result.push({ time: t, text });
	}

	// 4) 保险：排序
	result.sort((a, b) => a.time - b.time);

	return result.length ? result : [{ time: 0, text: "暂无歌词" }];
}


function pickLyricUser(u) {
	if (!u || typeof u !== "object") return null;

	// 只保留 UI 可能会展示的最小集合
	const uid = u.userid != null ? Number(u.userid) : null;
	const name = u.nickname != null ? String(u.nickname) : "";
	const uptime = u.uptime != null ? Number(u.uptime) : null;

	if (!uid && !name) return null;

	return {
		uid: uid || 0,
		name: name || "",
		uptime: uptime || 0,
	};
}

/**
 * ✅ raw(旧/新接口) → cooked(v3)
 * @param {object} rawData - apiService.getLyricData 返回的对象（旧缓存也可能是它）
 * @param {string|number} songId
 * @returns {object} cooked
 */
export function cookLyricsFromRaw(rawData, songId) {
	// rawData 可能为空/异常
	const raw = rawData && typeof rawData === "object" ? rawData : {};

	// 1) 解析三种歌词（parseLyric 支持多时间戳且过滤空正文）
	const originalArr = raw?.lrc?.lyric ? parseLyric(raw.lrc.lyric) : null;
	const translationArr = raw?.tlyric?.lyric ? parseLyric(raw.tlyric.lyric) : null;
	const romajiArr = raw?.romalrc?.lyric ? parseLyric(raw.romalrc.lyric) : null;

	// 2) 推断 lyricType（与你原 mergeLyrics 一致）
	let type = "chinese";
	if (romajiArr && translationArr) type = "japanese";
	else if (romajiArr && !translationArr) type = "cantonese";
	else if (translationArr) type = "english";
	else type = "chinese";

	// 3) 对齐 translation/romaji（按 time.toFixed(3) 键）
	const createMap = (arr) => {
		if (!arr || !arr.length) return null;
		const m = new Map();
		for (const it of arr) {
			if (!it || typeof it.time !== "number") continue;
			const key = it.time.toFixed(3);
			const val = (it.text || "").trim();
			if (val) m.set(key, val);
		}
		return m.size ? m : null;
	};

	const transMap = createMap(translationArr);
	const romaMap = createMap(romajiArr);

	// 4) 生成 cooked lines（只存事实数据，不存 UI 状态）
	let lines = [];
	if (originalArr && originalArr.length) {
		lines = originalArr
			.map((line) => {
				const key = line.time.toFixed(3);
				const o = (line.text || "").trim();

				if (!o) return null;

				const out = { t: line.time, o };

				const tr = transMap ? transMap.get(key) : null;
				const ro = romaMap ? romaMap.get(key) : null;

				if (tr) out.tr = tr;
				if (ro) out.ro = ro;

				return out;
			})
			.filter(Boolean);
	}

	if (!lines.length) {
		lines = [{ t: 0, o: "暂无歌词" }];
	}

	// 5) 贡献者（可选；旧缓存没有就 null）
	const by = {
		lyric: pickLyricUser(raw.lyricUser),
		trans: pickLyricUser(raw.transUser),
	};

	// 6) 版本/标记
	return {
		v: 3,
		songId: String(songId),
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
 * 可选：构造一个兜底 cooked（网络失败/坏文件时）
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
