# Kiro Account Manager

## 项目基础信息

- **技术栈**：Electron + React + TypeScript + Zustand + Tailwind CSS + Vite (electron-vite)
- **最低支持版本**：Node.js >= 18, npm >= 9
- **许可证**：AGPL-3.0
- **当前版本**：v1.5.0

## 项目结构

实际代码位于仓库根目录下的 `Kiro-account-manager/` 子目录中：

```
Kiro-account-manager/          ← 仓库根目录
├── .github/workflows/         ← CI/CD（GitHub Actions 多平台构建）
├── Kiro-account-manager/      ← 实际 Electron 项目目录
│   ├── src/
│   │   ├── main/              ← Electron 主进程
│   │   │   ├── kproxy/        ← K-Proxy 服务
│   │   │   └── proxy/         ← API 反代服务
│   │   ├── preload/           ← Electron preload 脚本
│   │   └── renderer/          ← React 前端
│   │       └── src/
│   │           ├── components/ ← UI 组件
│   │           ├── hooks/      ← React Hooks
│   │           ├── i18n/       ← 国际化（中/英）
│   │           ├── lib/        ← 工具库
│   │           ├── services/   ← 服务层
│   │           ├── store/      ← Zustand 状态管理
│   │           ├── styles/     ← 样式
│   │           └── types/      ← TypeScript 类型定义
│   ├── electron-builder.yml   ← 打包配置
│   ├── electron.vite.config.ts ← Vite 构建配置
│   └── package.json
└── CLAUDE.md
```

## 开发协议

本项目在 Claude Code 侧使用 `./.claude/skills/protocol-dev/` 作为通用开发协议 skill，使用 `./.claude/skills/repo-detach-reset/` 处理克隆仓库去关联与历史重置场景。生成提交信息时必须遵循 `protocol-dev` 的 commit 规范。

### 关键约束

- 任何代码变更需求，必须先给方案，等待用户明确授权后才能执行
- 仓库去关联/重置类破坏性操作（如删除历史、切断 remote）必须先给方案，明确风险与回滚点，等待用户授权后执行
- 克隆仓库 DIY 时必须先做 License 检查；许可证义务不明确时默认不删除许可证与版权声明
- 去关联操作必须隔离原工作流与部署链路，禁止将部署任务误触发到原作者仓库或原命名空间
- 禁止使用 `rm` 删除文件，必须使用 `trash`
- `git commit` 流程：先输出 commit 信息供用户审核，用户确认后再执行提交，提交内容必须与展示内容完全一致，禁止附加任何辅助编程标识信息（如 Co-Authored-By 等）
- 禁止使用 Markdown 表格
- `git worktree` 规范：新建 worktree 时，必须将工作树创建在项目同级目录下，目录名格式为 `{项目名}--{分支名}`（分支名中的 `/` 替换为 `-`）。例如项目为 `my-app`，分支为 `feat/login`，则 worktree 路径为 `../my-app--feat-login/`。禁止使用默认的 `.git/worktrees` 或项目内部路径
