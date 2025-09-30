<p align="center">
  <img src="./src/common/icon.png" alt="OMusic Logo" width="150">
</p>

<h1 align="center">OMusic</h1>

<p align="center">
  <strong>一款专为 VelaOS 智能手表打造的第三方网易云音乐客户端。</strong>
    

  轻量、高效，专为圆形小屏优化，提供核心的音乐播放体验。
</p>

<p align="center">
    <img src="https://img.shields.io/badge/platform-VelaOS-blue.svg" alt="Platform">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-red.svg" alt="License">
    <img src="https://img.shields.io/badge/author-OrPudding-orange.svg" alt="Author">
</p>

---

## ✨ 功能特性

OMusic 充分利用了 VelaOS 的原生能力 ，旨在提供流畅、完整的音乐体验。

- **核心播放**:
  - 完整的播放器界面，支持播放、暂停、上一首、下一首。
  - 支持 **本地缓存** 与 **在线播放** 智能切换。
  - 滚动歌词显示，支持展开/收起模式。
  - 锁屏界面歌词显示（依赖系统支持）。

- **多功能列表**:
  - **播放列表**: 管理当前播放队列。
  - **已下载列表**: 查看所有已离线缓存的歌曲。
  - **我的收藏**: 同步您在网易云音乐中“我喜欢的音乐”列表。
  - **在线歌单**: 查看指定的用户歌单。
  - **高效懒加载**: 所有列表均采用虚拟列表（LazyList）技术，即使面对海量歌曲也能保持极致流畅。

- **强大的歌词系统**:
  - 自动拉取并显示歌词。
  - 支持 **日/英语歌词** 的 **翻译**、**罗马音** 显示。
  - 用户可在设置中自由切换歌词显示模式。

- **用户与登录**:
  - 支持通过输入用户ID获取公开信息（头像、昵称）。
  - 个人中心页面，清晰展示登录状态。

- **搜索与发现**:
  - 实时搜索网易云音乐曲库。
  - 搜索历史记录，方便快速再次搜索。
  - 搜索结果同样采用懒加载，性能卓越。

- **下载与离线**:
  - 支持将喜欢的歌曲（包括VIP歌曲）下载到手表本地。
  - 自动缓存歌词文件，实现完全离线播放。
  - 启动时自动清理异常中断的下载任务，保证应用状态健康。

- **高度可定制化**:
  - **设置中心**: 允许用户根据设备性能和网络状况，自由调整各项参数。
  - **性能设置**: 自定义列表渲染数量（`WINDOW_SIZE`）和加载步长（`PAGE_SIZE`）。
  - **网络设置**: 自定义在线歌单的加载总数和网络请求分页大小。

## 🚀 技术栈

- **开发框架**: [VelaOS 快应用](https://iot.mi.com/vela/quickapp/ )
- **核心 API**:
  - `@system.audio` - 音频播放
  - `@system.fetch` / `@system.request` - 网络请求
  - `@system.file` - 本地文件系统（用于缓存、下载、配置持久化）
  - `@system.router` - 页面路由
  - `@system.prompt` - 系统提示
- **第三方 API**: [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi ) (由 `https://163api.qijieya.cn/` 提供服务 )

## 🛠️ 如何使用

1.  使用 VelaOS 开发者工具将本项目编译并推送到您的智能手表设备。
2.  打开应用，默认进入播放器页面。
3.  点击菜单按钮，可以进入 **搜索**、**列表**、**个人中心** 等功能。
4.  在 **个人中心** -> **登录** 页面，输入您的网易云音乐用户ID，以同步您的个人歌单和收藏。
5.  在 **设置** 页面，根据您的设备型号和网络环境，调整性能与网络参数以获得最佳体验。

## 📜 开源许可

本项目基于 **GNU Affero General Public License v3.0** 开源。

- **AGPL-3.0 License**: 详情请见 [LICENSE](LICENSE) 文件。

本项目使用了以下第三方库/资源，特此感谢：

- **[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi )**: Licensed under the **MIT License**.
- **[Material Symbols](https://fonts.google.com/icons )**: Licensed under the **Apache License 2.0**.

---

<p align="center">
  由 OrPudding 使用 ❤️ 制作
</p>
