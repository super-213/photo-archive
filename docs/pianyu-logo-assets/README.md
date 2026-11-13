# 片隅 / Logo assets

- `logo.svg`: 主要深色矢量标识（透明背景）
- `logo-light.svg`: 浅色反白矢量标识（适用于深色背景）
- `logo-N.png`: 对应 N×N 像素透明背景 PNG
- `favicon.ico`: 兼容旧式浏览器的多尺寸图标

网站可使用：

```html
<link rel="icon" type="image/svg+xml" href="/logo.svg" />
<link rel="icon" sizes="any" href="/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="/logo-180.png" />
```

部署时将上述资源放进 `public/` 目录。
