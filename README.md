# 拥抱世界

剧本到视频的一体化创作工作台。项目采用前后端分离架构：

- `frontend`: React、Vite、TypeScript
- `backend`: Express、TypeScript、Zod
- `database`: 默认本地 SQLite，支持切换到 localhost MySQL

## 本地启动

```bash
npm install
copy .env.example backend\.env
npm run dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:8787/api>
- Health: <http://localhost:8787/api/health>

打开 Web 首页后，点击“新建项目”会进入项目设定；也可以在已有项目卡片上点击“剧本解析”直接进入解析步骤。项目内部顶部导航固定为：项目设定 → 剧本格式化 → 剧本解析 → 主体生成 → 故事板。

SQLite 数据库会在首次启动时自动创建于 `backend/data/script-master.db`。

## DeepSeek 流水线引擎

格式化、分集、主体提取和分镜提取使用 `deepseek-v4-flash`。可以直接在网站右上角“设置”中配置，也可以在 `backend/.env` 中配置：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_BASE=https://api.deepseek.com
```

格式化接口会要求模型返回原文逐字审计结果；服务端会校验审计文本与输入完全一致，并将原文归档到格式化结果中。未配置 Key 时，模型步骤会停止并提示配置，不会静默生成示例结果。如需离线演示，可在 `backend/.env` 增加 `LOCAL_FALLBACK=true`。

在“剧本解析”中，每集可以展开查看完整结构：开场钩子、本集原文、情节节点、参与人物，以及每个人物的介绍、穿着、性格、表情/状态和连续性备注。以上字段由 DeepSeek 返回后保存到本地数据库，缺失信息会标记为“未设定”，不会由服务端臆造。

## 使用 localhost MySQL

本机安装 Docker 后运行：

```bash
docker compose up -d mysql
```

然后把 `backend/.env` 中的 `DATABASE_URL` 改为：

```env
DATABASE_URL=mysql://script_master:script_master@localhost:3306/script_master
```

初始化结构位于 `backend/sql/mysql-init.sql`。

## API

- `GET /api/health` 服务状态
- `GET /api/dashboard` 首页数据
- `GET /api/projects` 项目列表
- `POST /api/projects` 创建项目
- `GET /api/projects/:id` 项目与分镜详情
- `GET /api/projects/:id/pipeline` 流水线全部产物
- `POST /api/projects/:id/format` 保真格式化剧本
- `POST /api/projects/:id/episodes/extract` DeepSeek 分集
- `POST /api/projects/:id/subjects/extract` DeepSeek 主体提取
- `POST /api/projects/:id/shots/extract` DeepSeek 分镜提取
- `PATCH /api/projects/:id` 更新项目
- `POST /api/projects/:id/generate-script` 生成脚本草案
- `POST /api/projects/:id/render` 创建渲染任务
- `GET /api/jobs` 渲染任务列表
