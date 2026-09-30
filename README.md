<p align="center">
  <img src="public/logo.png" alt="Muse" width="96" height="96">
</p>

<h1 align="center">Muse</h1>

<p align="center">
  <strong>导入音频媒体，生成并播放 MIDI。</strong>
</p>

<p align="center">
  目前仅支持音频媒体转录，以及原音和 MIDI 结果播放。
</p>

<p align="center">
  <a href="#下载">下载</a> •
  <a href="#工作原理">工作原理</a> •
  <a href="#模型与准确率">模型与准确率</a> •
  <a href="#从源码构建">从源码构建</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="支持平台">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="许可证">
</p>

## 功能特性

- **音频媒体转录**：导入 MP3、WAV、OGG、FLAC、M4A、AAC 或 WMA 文件，生成 MIDI。
- **独奏钢琴转录**：Demucs 从混音中分离钢琴，Transkun V2 进行转录，PM2S 负责左右手、调号和拍号识别。
- **多乐器转录**：YourMT3+ 一次性转录全部乐器，最多支持 13 个轨道。
- **原音与 MIDI 播放**：在应用内播放原始音频和转录结果，并支持 MIDI 音量、进度和轨道控制。
- **本地运行**：基于 Tauri 2 的原生桌面应用，音频不会离开你的设备。

---

## 下载

请前往 [**GitHub Releases**](https://github.com/lmxy1990/muse/releases) 下载最新版本。

| 平台 | 文件 |
|------|------|
| macOS（Apple Silicon） | `Muse_x.x.x_aarch64.dmg` |
| macOS（Intel） | `Muse_x.x.x_x64.dmg` |
| Windows | `Muse_x.x.x_x64-setup.exe` |
| Linux（Debian/Ubuntu） | `muse_x.x.x_amd64.deb` |
| Linux（AppImage） | `Muse_x.x.x_amd64.AppImage` |

你需要安装 **Python 3.10+**。Muse 首次运行时会自动创建独立虚拟环境、安装转录依赖并下载 PM2S 模型（约 3 GB）。第一次转录可能需要几分钟，请保持应用运行并确保设备可以访问网络。

---

## 工作原理

### 独奏钢琴

```
音频 → Demucs htdemucs_6s → 钢琴音轨 → Transkun V2 → PM2S → 乐谱 MIDI + 演奏 MIDI
```

1. **Demucs** 使用 6 源 Hybrid Transformer 从混音中分离钢琴音轨。如果输入本身就是独奏录音，可以传入 `--solo-piano` 跳过这一步。
2. **Transkun V2** 使用在 MAESTRO 数据集上训练的 Transformer + Neural Semi-CRF，将钢琴音轨转换为音符事件（音高、起音、结束和力度）。
3. **PM2S** 进行后处理：使用 RNN 拆分左右手，另一个 RNN 识别调号，CNN 识别拍号。延音踏板只写入演奏 MIDI，乐谱 MIDI 保持整洁。

输出文件：`song.mid`（含左右手信息的乐谱版）和 `song.perf.mid`（包含延音踏板的演奏版）。

### 多乐器

```
音频 → YourMT3+（YPTF.MoE+Multi）→ 多轨 MIDI（最多 13 个声部）
```

YourMT3+ 一次性转录所有乐器，不需要音源分离，适合完整编曲。CPU 推理处理 30 秒音频大约需要 2 分钟，使用 GPU 会明显更快。

---

## 模型与准确率

### 钢琴转录：Transkun V2

| 数据集 | 起音 F1 | 起音+结束 F1 |
|--------|---------|--------------|
| MAESTRO（音乐会钢琴） | 0.96–0.97 | 0.93–0.95 |
| SMD（合成钢琴） | 0.92–0.94 | 0.89–0.92 |
| MAPS（真实录音） | 0.78–0.82 | 0.66–0.70 |

Transkun 使用 MAESTRO 数据集训练，主要包含 Yamaha CFX 和 Steinway D 的录音。对于合成钢琴、电钢琴以及非标准音色，准确率会下降。

### 多乐器：YourMT3+

YourMT3+（YPTF.MoE+Multi）是直接将音频转换为多轨 MIDI 的混合专家 Transformer。它在大型多乐器数据集上训练，没有使用移调增强，因此可以适应更多曲风和录音条件。

### 左右手拆分：PM2S

PM2S 使用理解音乐上下文的 RNN 为每个音符分配左右手，考虑声部进行、手掌跨度和时间距离。相比简单地以中央 C 分割音高，它在左右手交叉的曲目上可靠得多。

| 组件 | 指标 |
|------|------|
| 节拍跟踪 RNN | F1：0.888 |
| 强拍跟踪 RNN | F1：0.773 |
| 手部分离 RNN | 逐音符二分类 |

### 音源分离：Demucs htdemucs_6s

6 声道 Hybrid Transformer Demucs 可分离钢琴、贝斯、吉他、人声、鼓和其他声部。在混音中的干净原声钢琴上 SDR 约为 7–9 dB；对于合成/电钢琴以及经过大量处理或质量较低的录音，效果会下降。

---

## 已知限制

- **Transkun 主要针对音乐会钢琴训练**：对 Steinway 以外的钢琴、合成器、电钢琴和非标准音色，转录效果可能较差。
- **YourMT3+ 在没有 GPU 时速度较慢**：CPU 处理 30 秒音频大约需要 2 分钟，长曲目建议使用 GPU。
- **保留演奏时值，不强制量化**：乐谱 MIDI 会贴合节拍网格，Rubato 和其他演奏时值变化会保留在演奏 MIDI 中。
- **目前只支持 MIDI**：MusicXML 导出功能仍在规划中。

---

## 从源码构建

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/)（最新稳定版）
- Python 3.10+
- Git（用于安装 PM2S 和音频评估依赖）
- Tauri 2 平台依赖：[安装前置条件](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
git clone https://github.com/lmxy1990/muse.git
cd muse/app
npm install

npm run dev          # 启动 Vite 开发服务和 Tauri 窗口
npm run tauri build  # 构建应用，中间文件位于 app/src-tauri/target/

# Windows：构建并将最终安装包复制到 ../artifacts/
npm run build:windows
```

Linux 和 macOS 的发布脚本也会将最终安装包复制到仓库根目录的 `artifacts/`。`app/src-tauri/target/` 只用于保存构建中间文件。

首次运行时会自动在 `~/.audio2sheets/venv/` 创建 Python 环境。也可以手动创建：

```bash
python3 -m venv ~/.audio2sheets/venv
~/.audio2sheets/venv/bin/pip install -r python/requirements.txt
```

如果需要多乐器模式，请在项目根目录克隆 YourMT3+：

```bash
git clone https://github.com/mimbres/YourMT3.git yourmt3
```

---

## 项目结构

```
muse/
├── app/                    Tauri 2 桌面应用
│   ├── src/                SolidJS 前端（视图、组件、状态和工具库）
│   └── src-tauri/          Rust 后端（流水线命令、虚拟环境设置）
├── python/
│   └── pipeline.py         双后端机器学习流水线（Transkun / YourMT3+）
├── src/                    Node.js CLI 和库
└── tests/                  单元、集成、端到端和浏览器测试
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面应用 | [Tauri 2](https://v2.tauri.app/) |
| 前端 | [SolidJS](https://www.solidjs.com/) + [Tailwind CSS 4](https://tailwindcss.com/) |
| 后端 | Rust |
| 机器学习流水线 | Python + [PyTorch](https://pytorch.org/) |
| 钢琴转录 | [Transkun V2](https://github.com/Yujia-Yan/Transkun) |
| 多乐器转录 | [YourMT3+](https://arxiv.org/abs/2407.04822) |
| 音源分离 | [Demucs htdemucs_6s](https://github.com/facebookresearch/demucs) |
| 左右手拆分 | [PM2S](https://github.com/cheriell/PM2S)（ISMIR 2022） |
| MIDI 播放 | [smplr](https://github.com/danigb/smplr) |

---

## 研究说明

### 为什么选择这些模型？

选择转录模型需要在准确率、运行速度和部署复杂度之间取舍：

| 模型 | 参数量 | MAESTRO 起音 F1 | 可否在 Node.js 中部署 |
|------|--------|----------------|----------------------|
| Basic Pitch（Spotify） | 约 17K | 约 85–90% | 可以（npm） |
| Onsets & Velocities | 约 3.1M | 96.78% | 可以（ONNX） |
| Onsets and Frames（Magenta） | 约 21M | 约 94.8% | 可以（tfjs，单向 LSTM） |
| **Transkun V2** | 中等 | **96–97%** | Python 子进程 |
| MT3 系列 | 约 3 亿以上 | 不适用 | 不可以（自回归） |

MT3（以及文本生成模式下的 MR-MT3、YourMT3）基于 T5，是一种逐 token 生成文本的 Transformer，每一步都依赖之前生成的结果。转录 30 秒音频意味着数千个无法并行的连续解码步骤。在没有高性能 GPU 的本地机器上，短音频也可能需要几分钟，这是架构本身决定的。其他模型则通过一次前向推理同时预测全部音符。

Transkun V2 在准确率和 Python API 方面表现最好。早期也考虑过 Basic Pitch，但它容易把泛音误判为真实音符，例如将高出 12、19 或 24 个半音的泛音识别成独立音符，难以抑制。

**关于量化**：PM2S 同时提供量化 RNN 和手部分离模型。实测平均起音偏移约为 164 ms（P95 为 385 ms），快速段落中会产生明显的听感瑕疵。手部分离 RNN 很可靠，但量化 RNN 不够稳定，因此项目同时输出量化后的乐谱 MIDI 和未经量化的演奏 MIDI。

**关于多乐器**：Demucs 分离音源后再逐轨转录会累积误差，分离伪影会变成转录错误，最终合并成不完整的多轨结果。YourMT3+ 一次性处理全部乐器，流水线更简单，输出也更干净。

### 相关项目

| 工具 | 价格 | 输出 | 说明 |
|------|------|------|------|
| AnthemScore | 29–99 美元 | MusicXML、MIDI | 适合独奏钢琴 |
| Klangio | 订阅制 | MusicXML、MIDI、PDF | 云端服务 |
| Melodyne | 99–699 美元 | MIDI | 音高编辑能力强 |
| ScoreCloud | 免费–每月 20 美元 | MusicXML | 复杂复调表现较弱 |
| **Muse** | 免费 | MIDI | 开源，可本地运行 |

---

## 许可证

[MIT](LICENSE)

本项目基于 https://github.com/mqtik/muse 改造。
