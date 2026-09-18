# 拥抱世界

面向短剧、动画和 AI 视频制作的本地一体化创作工作台。项目把剧本格式化、剧本分集、主体管理、分镜设计、图片生成、视频生成、镜头连续性和资产归档放在同一个工作区中，并提供节点式无限画布用于自由编排完整生产流程。

## 主要能力

### 项目创作流程

- 创建项目并设置故事简介、内容类型、视觉风格和画面比例。
- 使用内置提示词或自定义系统提示词格式化原始剧本。
- 将格式化后的完整剧本拆分为单集内容。
- 按集提取角色、场景和物品，重复主体会在项目内复用。
- 为主体生成角色四视图、场景三段式设定图或物品四视图，并自动加入资产库。
- 按集生成详细分镜；镜头数量根据剧情、动作、对白和场景复杂度自动决定，不设固定上限。
- 分镜会绑定本集主体及其参考图，并根据对白、动作和镜头复杂度推荐 3–12 秒的时长。
- 每个分镜可独立选择视频模型并生成视频。
- 支持使用上一镜头尾帧延续动作，也可明确切镜或切换场景。
- 将多个已完成镜头按顺序合并为成片。

### 无限画布
![无限画布完整工作流](./docs/images/infinite-canvas-workflow.png)

无限画布使用节点和连线组织生产流程，支持：
- 账号隔离的服务端持久化，画布不再以浏览器存储作为数据源。
- 新用户首次进入时自动将当前浏览器中的旧画布迁移到该账号。
- 剧本输入与剧本格式化节点。
- 单集剧本节点。
- 角色、场景、物品等主体节点。
- 分镜、图片、视频、文本和合成节点。
- 按集提取主体、生成分镜和生成视频。
- 主体参考图持续显示在对应分镜卡片中。
- 单节点删除、全部清理和节点排版重置。
- 画布平移、缩放、框选和资产拖入。
- 生成结果自动连线，并归档到资产库。

旧分镜不会自动获得新字段。修改了分镜规则、推荐时长或主体引用后，需要在对应单集节点中重新生成分镜。

### 独立工具

“更多工具”中提供无需创建项目即可使用的独立工作区：

- 角色图片、场景图片、物品图片。
- 参考图生视频、首尾帧视频。
- 提示词工坊。
- MiniMax 声音克隆和文转语音。
- 火山引擎 4K / 8K 一键高清。
- Vidu Live + AliRTC 实时数字人。
- 无限画布。

生成完成的图片、音频、视频和成片会统一显示在资产库中。没有有效媒体地址的空记录不会显示。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、XYFlow、Lucide |
| 后端 | Node.js、Express 5、TypeScript、Zod |
| 数据库 | SQLite（默认）或 MySQL 8 |
| 文本模型 | DeepSeek 兼容接口 |
| 图片生成 | 火山方舟、阿里云百炼、OpenAI 或兼容接口 |
| 视频生成 | 火山方舟及兼容视频接口 |
| 图片高清 | 火山引擎视觉智能服务 |
| 临时图片存储 | 阿里云 OSS |
| 声音 | MiniMax |
| 实时数字人 | Vidu Live、WebSocket、AliRTC |
| 视频处理 | FFmpeg |

## 目录结构

```text
script_master/
├─ frontend/                 React 前端
│  └─ src/
│     ├─ App.tsx             主应用、项目流程与独立工具
│     ├─ InfiniteCanvasStudio.tsx
│     ├─ api.ts              前端 API 封装
│     └─ styles.css
├─ backend/                  Express API 服务
│  ├─ src/
│  │  ├─ server.ts           路由与业务编排
│  │  ├─ database.ts         SQLite / MySQL 数据层
│  │  ├─ llm.ts              剧本、分集、主体与分镜处理
│  │  ├─ image.ts            图片生成
│  │  ├─ video.ts            视频生成
│  │  ├─ upscale.ts          图片高清
│  │  ├─ oss.ts              OSS 临时上传
│  │  ├─ voice.ts            声音克隆与文转语音
│  │  └─ vidu.ts             实时数字人
│  ├─ sql/mysql-init.sql
│  └─ .env.example
├─ docker-compose.yml        可选 MySQL 环境
└─ package.json              npm workspace 入口
```

## 环境要求

- Node.js 22 或更高版本，推荐使用当前 LTS 版本。
- npm 10 或更高版本。
- FFmpeg：使用镜头尾帧连续性、视频合并和封面提取时需要。
- Docker Desktop：仅在选择 MySQL 时需要。
- 可用的第三方模型账号和密钥：只配置实际要使用的服务即可。

确认基础环境：

```bash
node --version
npm --version
ffmpeg -version
```

## 快速启动

### 1. 安装依赖

在项目根目录执行：

```bash
npm install
```

### 2. 创建后端配置

Windows PowerShell：

```powershell
Copy-Item backend/.env.example backend/.env
```

macOS / Linux：

```bash
cp backend/.env.example backend/.env
```

按需编辑 `backend/.env`。至少需要配置 `DEEPSEEK_API_KEY` 才能运行剧本相关模型步骤；图片、视频、高清、声音和数字人使用各自独立的配置。

### 3. 启动前后端

```bash
npm run dev
```

默认地址：

- Web：<http://localhost:5173>
- API：<http://localhost:8787/api>
- 健康检查：<http://localhost:8787/api/health>

如果 5173 端口已占用，Vite 会提示实际使用的新端口。此时需要同步调整后端 `CLIENT_ORIGIN`，再重启服务。

## 数据库

账号、登录会话、项目和无限画布分别保存在 `users`、`user_sessions`、`projects`、`canvas_projects` 表中。登录使用服务端异步 scrypt 密码哈希和 HttpOnly Cookie。项目、画布、渲染任务、独立工具资产及数字人会话都从登录会话确定用户，客户端不能传入用户编号访问其他账号的数据。

本地开发时，第一个注册账号会成为管理员。生产环境不会把公开注册用户提升为管理员，首次启动前必须通过服务端环境变量创建初始管理员；管理员创建成功后应从运行环境中移除明文的 `ADMIN_BOOTSTRAP_PASSWORD`。只有管理员可以修改模型服务配置：

```env
NODE_ENV=production
ADMIN_BOOTSTRAP_ACCOUNT=admin
ADMIN_BOOTSTRAP_PASSWORD=replace_with_at_least_12_characters
```

若升级前已经存在 `user_id` 为空的历史项目，在配置中显式设置 `LEGACY_OWNER_ACCOUNT`，该管理员登录后才会接管历史数据：

```env
LEGACY_OWNER_ACCOUNT=your_admin_account
```

### SQLite（默认）

本地开发无需额外安装数据库：

```env
DATABASE_URL=sqlite://./data/script-master.db
```

数据库文件会写入 `backend/data/`，该目录已从 Git 中忽略。

### MySQL（可选）

启动项目自带的 MySQL 8 容器：

```bash
docker compose up -d mysql
```

然后在 `backend/.env` 中设置：

```env
DATABASE_URL=mysql://script_master:script_master@localhost:3306/script_master
```

后端首次启动时会自动创建或补齐所需表；`backend/sql/mysql-init.sql` 也可用于手动初始化。生产环境请更换 `docker-compose.yml` 中的默认账号和密码。

## 服务配置

所有密钥必须放在 `backend/.env` 或服务端的安全环境变量中，不要使用 `VITE_` 前缀，也不要提交到 Git。

### 基础配置

```env
PORT=8787
CLIENT_ORIGIN=http://localhost:5173
TRUST_PROXY=false
DATABASE_URL=sqlite://./data/script-master.db
MEDIA_SIGNING_SECRET=replace_with_at_least_32_random_bytes
LOCAL_FALLBACK=false
```

`MEDIA_SIGNING_SECRET` 用于生成第三方视频平台读取参考媒体时所需的短时签名地址。生产环境必须使用独立随机值，并在所有 API 实例中保持一致。

`CLIENT_ORIGIN` 是允许携带登录 Cookie 调用 API 的前端来源；多个来源用英文逗号分隔。只有后端确实位于可信反向代理之后时才将 `TRUST_PROXY` 设为 `true`，否则登录限流会忽略客户端伪造的转发地址。

`LOCAL_FALLBACK=true` 仅用于离线界面演示。正式生产流程应保持为 `false`，让缺失配置或模型错误直接暴露出来。

### DeepSeek

用于剧本生成、格式化、分集、主体提取和分镜提取：

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_BASE=https://api.deepseek.com
```

剧本格式化支持自定义系统提示词。输入自定义提示词时会替代内置格式化提示词；留空则使用系统内置规则。

### 图片生成

```env
IMAGE_PROVIDER=volcengine
IMAGE_API_KEY=your_image_api_key
IMAGE_MODEL=doubao-seedream-5-0-pro-260628
IMAGE_API_BASE=https://ark.cn-beijing.volces.com/api/v3
```

也可以在页面右上角的模型设置中切换兼容平台、模型和 API 地址。环境变量适合作为服务重启后仍然存在的默认配置。

### 视频生成

```env
VIDEO_PROVIDER=volcengine
VIDEO_API_KEY=your_video_api_key
VIDEO_MODEL=doubao-seedance-2-0-mini-260615
VIDEO_API_BASE=https://ark.cn-beijing.volces.com/api/v3
```

当前界面支持以下视频模型：

| 界面名称 | 模型 ID |
| --- | --- |
| Seedance 2.0 Mini | `doubao-seedance-2-0-mini-260615` |
| Seedance 2.0 | `doubao-seedance-2-0-260128` |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` |
| Seedance 2.5 | `doubao-seedance-2-5-260628` |

视频分辨率可选择 `480P`、`720P` 或 `1080P`，未指定时默认使用 `720P`。镜头推荐时长会在提交前自动对齐到平台支持的 `4 / 5 / 6 / 8 / 10 / 12` 秒档位。

当视频平台需要主动读取本地生成的参考图时，后端必须有公网可访问地址：

```env
VIDEO_PUBLIC_BASE_URL=https://your-public-backend.example.com
```

该地址应能访问后端的 `/api/generated/...` 文件。仅使用 `localhost` 时，远端视频平台无法读取本机图片。

### 一键高清与阿里云 OSS

一键高清使用火山引擎视觉服务的 AK/SK 签名：

```env
VOLCENGINE_VISUAL_ACCESS_KEY_ID=your_volcengine_access_key_id
VOLCENGINE_VISUAL_SECRET_ACCESS_KEY=your_volcengine_secret_access_key
VOLCENGINE_VISUAL_ENDPOINT=https://visual.volcengineapi.com
```

本地上传的图片会先写入阿里云 OSS，让火山引擎可以通过公网地址读取：

```env
ALIYUN_OSS_ACCESS_KEY_ID=your_aliyun_oss_access_key_id
ALIYUN_OSS_ACCESS_KEY_SECRET=your_aliyun_oss_access_key_secret
ALIYUN_OSS_SECURITY_TOKEN=
ALIYUN_OSS_REGION=oss-cn-beijing
ALIYUN_OSS_BUCKET=your_bucket_name
ALIYUN_OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com
ALIYUN_OSS_OBJECT_PREFIX=script-master/upscale-inputs
```

永久 RAM AccessKey 不需要填写 `ALIYUN_OSS_SECURITY_TOKEN`；只有临时 STS 凭证才需要。OSS 账号应只授予指定 Bucket 和前缀所需的最小权限。

### MiniMax 声音

声音克隆和文转语音共用以下配置：

```env
MINIMAX_API_KEY=your_minimax_api_key
MINIMAX_API_BASE=https://api.minimax.cn/v1
MINIMAX_VOICE_MODEL=speech-2.8-hd
```

声音样本支持 MP3、WAV 和 M4A，最大 20 MB。填写与样本完全一致的逐字稿可以提升克隆结果的稳定性。

### Vidu Live 实时数字人

```env
VIDU_API_KEY=your_vidu_api_key
VIDU_API_BASE=https://api.vidu.cn
VIDU_WS_BASE=wss://api.vidu.cn
VIDU_VIDEO_CREATE_TIMEOUT_MS=300000
VIDU_AUDIO_CREATE_TIMEOUT_MS=120000
```

实时数字人的工作过程为：后端创建 Live 会话，前端建立 WebSocket 控制链路并发送 `conn_init`，随后通过 AliRTC 入会收发音视频。上传图片只是数字人的形象来源；页面真正播放的是服务端发布的远端 RTC 视频流。

API Key 只能由后端发送给 Vidu，不能暴露给浏览器。`insufficient credits` 表示当前 Key 所属账号或项目的实时数字人额度不足，与页面显示的其他产品积分不一定属于同一计费账户。

### FFmpeg

系统默认从 `PATH` 中查找 `ffmpeg`。也可以显式指定：

```env
FFMPEG_PATH=C:/path/to/ffmpeg.exe
```

以下功能依赖 FFmpeg：

- 从上一镜头视频提取稳定尾帧。
- 镜头视频格式检查与转码。
- 多镜头顺序合并。
- 合成视频封面提取。

## 推荐使用流程

### 标准项目

1. 在首页创建项目，或选择“导入已有剧本”。
2. 输入剧本，按需填写系统提示词，执行“剧本格式化”。
3. 在格式化结果卡片底部点击“剧本分集”。
4. 在每一集卡片中提取本集主体。
5. 为角色、场景和物品选择风格、模型并生成参考图。
6. 在单集卡片中生成本集分镜，选择分镜风格并按需填写系统提示词。
7. 检查每个分镜绑定的主体参考图、推荐时长和视频模型。
8. 逐镜头生成视频；连续动作可使用上一镜头尾帧，场景变化时选择切镜。
9. 选择已完成镜头并合并成片。
10. 在资产库中查看和下载图片、音频、视频及成片。

### 无限画布

1. 从“更多工具 → 无限画布”进入画布。
2. 添加剧本节点并执行格式化，系统会创建并连接格式化结果节点。
3. 点击“剧本分集”，系统会按集创建独立卡片并自动连线。
4. 从单集节点提取主体；角色、场景和物品会成为独立节点。
5. 为主体生成图片后，参考图会同步到引用它的分镜卡片。
6. 从单集节点生成分镜，确认风格、系统提示词和主体绑定。
7. 在分镜节点中选择模型和时长，点击“生成视频”。
8. 生成的视频会成为已连接的视频节点，同时进入资产库。
9. 使用“节点排版重置”整理整条工作流。

## 视频连续性

视频生成提供四种连续性模式：

- `auto`：同场连续动作优先尝试承接，场景变化时自动切镜。
- `continue`：强制从上一镜头结束状态继续。
- `cut`：独立生成当前镜头，不使用上一镜头尾帧。
- `scene`：明确开始新的场景。

使用尾帧连续性必须满足：

1. 当前镜头不是本集第一个镜头。
2. 上一镜头已成功生成视频。
3. FFmpeg 可用并能读取上一镜头视频。
4. 视频平台支持接收首帧参考。

如果尾帧提取失败，自动模式会回退为直接切镜，并在服务日志中记录原因。

## 常用命令

```bash
# 同时启动前端和后端
npm run dev

# 构建前端和后端
npm run build

# TypeScript 类型检查
npm run typecheck

# 运行后端测试
npm run test -w backend

# 启动构建后的后端
npm run start
```

## 主要 API

### 系统与设置

- `GET /api/health`：健康检查。
- `GET /api/auth/session`：读取当前登录账号。
- `POST /api/auth/register|login|logout`：注册、登录和退出。
- `PATCH /api/auth/profile`：更新昵称、邮箱和头像地址。
- `POST /api/auth/avatar`：上传账号头像。
- `POST /api/auth/change-password`：修改密码并注销其他会话。
- `POST /api/auth/logout-all`：注销账号全部会话。
- `GET|PUT /api/settings/llm`：文本模型配置。
- `GET|PUT /api/settings/image`：图片模型配置。
- `GET|PUT /api/settings/video`：视频模型配置。
- `GET /api/dashboard`：首页数据。
- `GET /api/assets`：资产库。

### 项目流水线

- `GET|POST /api/projects`：项目列表与创建。
- `GET|PATCH|DELETE /api/projects/:id`：项目读取、修改和删除。
- `GET /api/projects/:id/pipeline`：读取项目全部产物。
- `POST /api/projects/:id/generate-script`：生成剧本草案。
- `POST /api/projects/:id/format`：格式化剧本。
- `POST /api/projects/:id/episodes/extract`：剧本分集。
- `POST /api/projects/:id/subjects/extract`：按项目或单集提取主体。
- `POST /api/projects/:id/subjects/:subjectId/image`：生成主体图片。
- `POST /api/projects/:id/shots/extract`：按项目或单集生成分镜。
- `PATCH /api/projects/:id/shots/:shotId`：修改分镜。
- `GET /api/projects/:id/shots/:shotId/continuity-preview`：预览上一镜头尾帧。
- `POST /api/projects/:id/render`：创建视频生成任务。
- `GET|POST /api/projects/:id/video-merges`：读取或创建镜头合并结果。
- `GET /api/jobs`：渲染任务列表。
- `GET /api/jobs/stream`：任务进度事件流。

### 独立工具

- `GET|POST /api/tools/:assetType-images`：角色、场景或物品图片。
- `GET|POST /api/tools/:videoType-videos`：参考图视频或首尾帧视频。
- `POST /api/tools/image-upscales`：4K / 8K 图片高清。
- `GET|POST /api/tools/voice-clones`：声音克隆。
- `GET|POST /api/tools/text-to-speech`：文转语音。
- `GET /api/tools/digital-human/status`：数字人服务状态。
- `POST /api/tools/digital-human/lives`：创建实时数字人会话。
- `DELETE /api/tools/digital-human/lives/:liveId`：结束实时数字人会话。

## 数据与生成文件

本地生成内容默认保存在 `backend/data/generated/`，包括图片、高清图、声音、视频、连续性尾帧和合成结果。数据库、生成文件、日志和环境配置均已在 `.gitignore` 中排除。

不要手动删除正在被任务使用的生成文件。备份项目时，应同时备份数据库和 `backend/data/generated/`。

## 常见问题

### 模型按钮不可用或提示未配置

检查对应服务的环境变量，而不是只配置一个通用 Key。DeepSeek、图片、视频、火山视觉、MiniMax 和 Vidu 使用相互独立的凭证。修改 `backend/.env` 后需要重启后端。

### 图片高清提示“本地上传的图片需要公网地址”

配置阿里云 OSS。后端会先把本地文件上传到 OSS，再把公网可读地址交给火山引擎。确认 Bucket、Region、Endpoint 和 RAM 权限一致。

### 视频平台无法读取参考图

配置 `VIDEO_PUBLIC_BASE_URL`，并确认该域名可以从公网访问 `/api/generated/...`。开发机上的 `localhost`、局域网地址和临时 Blob URL 对远端平台不可见。

### 数字人能通话但图片不动

本地上传预览不是动画画面。需要确认 Vidu 已返回 RTC 信息、WebSocket 收到 `conn_init_ack.success=true`、AliRTC 已入会，并且前端收到了远端视频轨道。如果只有声音，重点检查远端是否发布视频及浏览器自动播放权限。

### 所有镜头推荐时长都是 6 秒

这通常是旧分镜数据。重新生成本集分镜后，系统会根据内容计算不同推荐时长。新分镜卡片同时包含视频模型选择和“生成视频”按钮。

### 剧本格式化超时或保真校验失败

长剧本可能超过模型响应时间，或模型改写了不应改写的原文。可以缩短单次输入、简化自定义系统提示词后重试。关闭 `LOCAL_FALLBACK` 时，系统不会用示例内容掩盖真实错误。

### 视频合并或尾帧提取失败

确认 `ffmpeg -version` 可执行；如果未加入系统 `PATH`，在 `FFMPEG_PATH` 中填写可执行文件的绝对路径。

## 安全说明

- 不要将 `backend/.env`、真实 API Key、OSS 密钥或带签名的临时 URL 提交到仓库。
- 不要把服务端密钥写入前端代码或任何 `VITE_*` 环境变量。
- OSS、数据库和第三方 API 账号应使用最小权限。
- 声音克隆、数字人形象和真人素材必须取得合法授权。
- 除健康检查、注册和登录外，业务 API 默认要求有效登录会话；登录失败次数由数据库统一限流。
- 媒体文件会校验账号归属；提供给第三方平台的媒体地址使用短时 HMAC 签名。
- 正式部署必须启用 HTTPS、设置准确的 `CLIENT_ORIGIN`，并让反向代理保留 Cookie、SSE 和 WebSocket 连接。
- 多实例部署应共享 MySQL、生成文件存储和同一个 `MEDIA_SIGNING_SECRET`；本机磁盘只适合单实例部署。
- 上线前应建立 MySQL 与 `backend/data/generated/` 的定期备份和恢复演练，并配置日志轮转、监控和告警。

## License

本项目使用仓库根目录 [LICENSE](./LICENSE) 中的许可证。
