<div align="center"><h1>Cloud-PE One</h1></div>

<div align="center">

  [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
  ![Rust](https://img.shields.io/badge/Rust-1.77.2+-orange.svg?logo=rust)
  ![Tauri](https://img.shields.io/badge/Tauri-2.5.0-blue?logo=tauri)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue?logo=typescript)
  ![React](https://img.shields.io/badge/React-18.2-61dafb?logo=react)

  <p>Cloud-PE 的全新桌面客户端，让 Cloud-PE 启动盘制作更简单</p>
  
  [English](README_en.md) | 简体中文
</div>

<div align="center">
  <img width="700" alt="Cloud-PE One 主界面" src="https://github.com/user-attachments/assets/8be153f0-a354-4854-8232-15a807e64529" />
</div>

## ✨ 功能特性

- 🚀 **一键制作启动盘** - 简单快速地制作 Cloud-PE 启动盘
- 📦 **ISO 镜像生成** - 支持生成标准 ISO 镜像文件
- 🔌 **插件市场** - 丰富的插件生态，扩展更多功能
- 📥 **多线程下载** - 支持 8/16/32/64 线程高速下载
- 🌙 **主题切换** - 支持浅色/深色/跟随系统主题
- 🔄 **自动更新** - 应用内自动检测并更新到最新版本
- 📴 **离线模式** - 无网络连接时仍可使用基础功能
- 🎨 **Mica 效果** - Windows 11 下支持 Mica 透明效果

## 🛠️ 技术栈

### 后端
- **Rust** (1.77.2+) - 系统级编程语言
- **Tauri** (2.5.0) - 跨平台桌面应用框架

### 前端
- **TypeScript** (5.8.3) - 类型安全的 JavaScript
- **React** (18.2) - 用户界面框架
- **Vite** (6.3.5) - 下一代前端构建工具
- **coss ui** - 可访问的 React 组件库(Base UI + Tailwind CSS)

## 📋 系统要求

- Windows 10/11 (64-bit)
- 最低 4GB 内存
- 至少 500MB 可用磁盘空间
- 支持 UEFI 或 Legacy BIOS 启动模式

## 🚀 快速开始

### 环境准备

1. 安装 [Node.js](https://nodejs.org/) (18.0+)
2. 安装 [Rust](https://www.rust-lang.org/) (1.77.2+)
3. 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/Cloud-PE/Cloud-PE-One.git
cd Cloud-PE-One

# 安装依赖
npm install
```

### 开发调试

```bash
# 启动前端开发服务器
npm run dev

# 启动 Tauri 开发环境
npm run tauri:dev

# 或一键启动所有服务
cmd /c "start npm run tauri:dev"
```

### 构建发布

```bash
# 构建生产版本
npm run tauri build
```

构建产物将生成在 `src-tauri/target/release` 目录下。

## 📁 项目结构

```
Cloud-PE-One/
├── src/                    # React 前端源码
│   ├── api/               # API 接口层
│   ├── components/        # React 组件
│   ├── pages/            # 页面组件
│   ├── utils/            # 工具函数
│   └── App.tsx           # 应用入口
├── src-tauri/             # Rust 后端源码
│   ├── src/
│   │   ├── main.rs       # 主进程入口
│   │   ├── download.rs   # 下载模块
│   │   ├── plugins.rs    # 插件管理
│   │   ├── updater.rs    # 更新模块
│   │   └── usb_api.rs    # USB 设备接口
│   └── Cargo.toml        # Rust 依赖配置
└── package.json          # Node.js 依赖配置
```

### 开发规范

- 使用 ESLint 进行代码规范检查
- 提交前运行 `npm run lint` 确保代码质量
- 遵循语义化版本规范 (Semantic Versioning)

## 📄 许可证

本项目基于 [Apache 2.0](LICENSE) 许可证开源。

## 👥 开发团队

- **dddffgg** - 主要开发者
- **Hello,World!** - 共同开发者

## 🔗 相关链接

- [Cloud-PE 官方网站](https://cloud-pe.cn/)
- [在线文档](https://cloud-pe.cn/#/docs)
- [问题反馈](https://github.com/Cloud-PE/Cloud-PE-One/issues)

## 📮 联系我们

如有问题或建议，请通过以下方式联系：

- GitHub Issues: [提交问题](https://github.com/Cloud-PE/Cloud-PE-One/issues)
- 官方网站: [cloud-pe.cn](https://cloud-pe.cn/)

---

<div align="center">
  <sub>Copyright © 2025-Present Cloud-PE Dev. All rights reserved.</sub>
</div>
