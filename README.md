# Photo Archive

个人摄影作品集的前台静态 MVP。使用 Next.js App Router、TypeScript、CSS Variables 和本地字体。支持首页、摄影系列、照片档案、题材与年份组合筛选、沉浸式大图浏览和 About。

## 本地运行

需要 Node.js 20.9 或更高版本。

```sh
npm install
npm run dev -- --port 3000
```

把 `3000` 换成自己选择的空闲端口。服务监听 `127.0.0.1`。

开发模式使用 Webpack 轮询监听，兼容当前 macOS 环境的文件监听限制。正式服务使用 `npm run start`。

## Cloudflare Tunnel

正式运行时先构建，再启动本地生产服务。端口由启动参数指定。

```sh
npm run build
npm run start -- --port 3000
```

将已有 Cloudflare Tunnel 的目标服务设置为 `http://127.0.0.1:3000`，与实际启动端口保持一致。数据库、媒体存储与后台将在后续阶段接入。

## 内容与样式

- `src/lib/photos.json` 保存示例照片信息，文件在 `public/photos/`。年份为演示编排年份。
- `src/lib/content.ts` 保存临时站点名称、系列封面、照片关联和系列内排版。系列通过照片 ID 引用统一照片库。
- `src/app/globals.css` 定义设计 Token、响应式布局与减少动态效果支持。
- Archive 筛选保存在 `category` 和 `year` 查询参数中，支持刷新与浏览器前进后退。
- 大图浏览支持左右方向键、Esc、触屏左右滑动、照片信息面板，关闭后恢复焦点。

替换照片时同步填写实际宽高和替代文本。示例素材来源在每张照片的数据中，页面 `/about#credits` 可查。照片版权归各原作者所有。

## 验证

```sh
npm run typecheck
npm run build
```
