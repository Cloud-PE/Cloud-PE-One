<div align="center"><h1>Cloud-PE One</h1></div>

<div align="center">
  
  [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
  ![Rust](https://img.shields.io/badge/Rust-1.77.2+-orange.svg?logo=rust)
  ![Tauri](https://img.shields.io/badge/Tauri-2.5.0-blue?logo=tauri)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue?logo=typescript)
  ![React](https://img.shields.io/badge/React-18.2-61dafb?logo=react)
    
  <p>A brand new desktop client for Cloud-PE, making Cloud-PE bootable drive creation easier</p>
  
  English | [简体中文](README.md)
</div>

<div align="center">
  <img width="700" alt="Cloud-PE One Interface" src="https://github.com/user-attachments/assets/8be153f0-a354-4854-8232-15a807e64529" />
</div>

## ✨ Features

- 🚀 **One-Click Bootable Drive Creation** - Create Cloud-PE bootable drives quickly and easily
- 📦 **ISO Image Generation** - Support for generating standard ISO image files
- 🔌 **Plugin Marketplace** - Rich plugin ecosystem to extend functionality
- 📥 **Multi-threaded Downloads** - High-speed downloads with 8/16/32/64 thread support
- 🌙 **Theme Switching** - Light/Dark/System theme support
- 🔄 **Auto Updates** - Automatic in-app detection and updates
- 📴 **Offline Mode** - Basic functionality available without internet connection
- 🎨 **Mica Effects** - Mica transparency effects on Windows 11

## 🛠️ Tech Stack

### Backend
- **Rust** (1.77.2+) - Systems programming language
- **Tauri** (2.5.0) - Cross-platform desktop app framework

### Frontend
- **TypeScript** (5.8.3) - Type-safe JavaScript
- **React** (18.2) - User interface framework
- **Vite** (6.3.5) - Next-generation frontend build tool
- **coss ui** - Accessible component library (Base UI + Tailwind CSS)

## 📋 System Requirements

- Windows 10/11 (64-bit)
- Minimum 4GB RAM
- At least 500MB available disk space
- UEFI or Legacy BIOS boot mode support

## 🚀 Quick Start

### Prerequisites

1. Install [Node.js](https://nodejs.org/) (18.0+)
2. Install [Rust](https://www.rust-lang.org/) (1.77.2+)
3. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### Installation

```bash
# Clone the repository
git clone https://github.com/Cloud-PE/Cloud-PE-One.git
cd Cloud-PE-One

# Install dependencies
npm install
```

### Development

```bash
# Start frontend dev server
npm run dev

# Start Tauri development environment
npm run tauri:dev

# Or start all services with one command
cmd /c "start npm run tauri:dev"
```

### Build

```bash
# Build for production
npm run tauri build
```

The build artifacts will be generated in `src-tauri/target/release`.

## 📁 Project Structure

```
Cloud-PE-One/
├── src/                    # React frontend source
│   ├── api/               # API layer
│   ├── components/        # React components
│   ├── pages/            # Page components
│   ├── utils/            # Utility functions
│   └── App.tsx           # App entry
├── src-tauri/             # Rust backend source
│   ├── src/
│   │   ├── main.rs       # Main process entry
│   │   ├── download.rs   # Download module
│   │   ├── plugins.rs    # Plugin management
│   │   ├── updater.rs    # Update module
│   │   └── usb_api.rs    # USB device interface
│   └── Cargo.toml        # Rust dependencies
└── package.json          # Node.js dependencies
```

### Development Standards

- Use ESLint for code linting
- Run `npm run lint` before committing
- Follow Semantic Versioning

## 📄 License

This project is open source under the [Apache 2.0](LICENSE) license.

## 👥 Development Team

- **dddffgg** - Main Developer
- **Hello,World!** - Co-Developer

## 🔗 Links

- [Cloud-PE Official Website](https://cloud-pe.cn/)
- [Documentation](https://docs.cloud-pe.cn/)
- [Issue Tracker](https://github.com/Cloud-PE/Cloud-PE-One/issues)

## 📮 Contact

For questions or suggestions, please contact us via:

- GitHub Issues: [Submit Issue](https://github.com/Cloud-PE/Cloud-PE-One/issues)
- Official Website: [cloud-pe.cn](https://cloud-pe.cn/)

---

<div align="center">
  <sub>Copyright © 2025-Present Cloud-PE Dev. All rights reserved.</sub>

</div>
