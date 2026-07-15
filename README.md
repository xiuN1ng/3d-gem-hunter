# 宝石猎人 · 3D 开石原型

[![Build](https://github.com/xiuN1ng/3d-gem-hunter/actions/workflows/ci.yml/badge.svg)](https://github.com/xiuN1ng/3d-gem-hunter/actions/workflows/ci.yml)
[![Deploy](https://github.com/xiuN1ng/3d-gem-hunter/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/xiuN1ng/3d-gem-hunter/actions/workflows/deploy-pages.yml)

基于 Three.js 与 Vite 的 3D 开石游戏 MVP。玩家可以观察程序化原石、调整切割角度与深度，切开后根据种水、颜色、棉和裂纹进行估价与交易。

## 在线试玩

GitHub Pages 启用后访问：

<https://xiun1ng.github.io/3d-gem-hunter/>

## 已实现

- 程序化生成原石外形、皮壳与隐藏品质
- 供应商原石拥有可复现的卵圆、扁圆、长条、山子料等尺寸与形制差异
- 鼠标旋转、滚轮缩放、Shift 精细观察
- 可调切割角度、深度和实时切面预览
- 金刚砂轮、金刚线锯、开窗磨头三种实体工具及各自的进给/旋转动作
- 双裁剪半体开石动画、工具进度、粒子与音效
- 切面轮廓与皮壳共享确定性表面函数，避免切面错位或悬空
- 内部翡翠层、切面辉光与开石完成后的镜头聚焦
- 程序化玉肉：种水、颜色、棉和裂纹
- 切涨/切垮、估价、出售与换石循环
- 东方神秘感与工业机械控制台组合界面

## 本地运行

需要 Node.js LTS：

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

提交前完整验证（测试、生产构建与包体积预算）：

```bash
npm run validate
```

浏览器性能诊断可通过 `?perf-test=1` 启动。它会以移动端画质自动完成一次切割，并记录平均 FPS、P95 帧耗时、切面准备时间、长任务和 GPU 资源数量；GitHub CI 会在 Chrome 的软件 WebGL 环境中运行对应的兼容性门槛。

## 自动发布

- Pull Request 和非 `main` 分支只执行生产构建验证。
- 推送到 `main` 后，GitHub Actions 自动构建并发布 `dist` 到 GitHub Pages。
- 工作流采用最小权限；构建不需要第三方 API Key。

首次使用时，在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。

## 技术策略

当前版本以程序化变形网格作为原石外壳。切割时复用同一网格，通过互补裁剪平面形成两个半体；切面边界通过同一确定性表面函数逐方向求交，因此能贴合不规则皮壳，并在内部叠加程序化翡翠层。这一方案比高分辨率体素更适合 Web MVP。

后续计划将内部数据升级为体素/SDF，并继续使用 Mesh、3D 材质场、Reveal Mask 与动态切面负责最终表现。

## License

[MIT](LICENSE)
