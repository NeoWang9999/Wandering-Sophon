# 流浪智子深空 (Wandering Sophon)

WebGPU 粒子系统，基于 Next.js + Three.js (TSL Compute Shaders)。

## 环境要求

- **Node.js** ≥ 18
- **浏览器**：Chrome 113+ 或 Edge 113+（需支持 WebGPU）

## 启动

```bash
# 安装依赖
npm install

# 开发模式（默认 http://localhost:3000）
npm run dev
```

## 构建 & 生产运行

```bash
npm run build
npm run start
```

## 交互操作

| 操作 | 效果 |
|---|---|
| **拖拽** | 旋转视角 |
| **滚轮** | 缩放 |
| **单击粒子** | 飞向该粒子 |
| **Shift + 左键按住** | 吸引粒子形成球壳，移动鼠标粒子跟随 |

## 项目结构

```
src/
  app/              # Next.js App Router 入口
  components/
    SophonScene.tsx  # 核心：WebGPU 粒子系统 & 场景
public/
  envmap.hdr        # HDR 环境贴图
docs/
  product-spec.md   # 产品规格文档
```

## 可调参数

在 `src/components/SophonScene.tsx` 中搜索以下变量：

**流体漂流（默认状态）**
- `ambientMassU` — 流体流动强度
- `spinStrengthU` — 旋转力
- `velocityDampingU` — 速度阻尼
- `maxSpeedU` — 最大速度

**Shift+click 球壳吸引**
- `shellRadius` — 球壳半径
- `shellSpring` — 弹簧硬度
- `orbitForce` — 轨道旋转力
- `orbitDampingReduce` — 轨道阻尼降幅
