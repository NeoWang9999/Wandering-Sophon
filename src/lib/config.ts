// ============================================================
//  智子场景可调参数 — 所有常用参数集中在此，方便调整
// ============================================================

// ---------- 粒子数量 ----------
export const SOPHON_COUNT = 5000;        // 智子粒子数量
export const DUST_COUNT = 100000;        // 背景星尘数量

// ---------- 空间范围 ----------
export const INIT_SPACE_SIZE = 1000;     // 粒子初始分布范围（立方体边长）
export const BOUNDARY_SPACE_SIZE = 3000; // 粒子环绕边界大小（超出后从另一边出现）

// ---------- 粒子初始速度 ----------
export const INITIAL_VELOCITY = 0.1;     // 粒子初始随机速度倍率（越小初始越慢）

// ---------- 粒子物理参数 ----------
export const AMBIENT_MASS = 8e3;         // 吸引子引力强度（越大粒子加速越快）
export const SPIN_STRENGTH = 2.5;        // 自旋力强度（绕吸引子旋转的力）
export const VELOCITY_DAMPING = 0.08;    // 速度阻尼（每帧衰减比例，越大越快停下）
export const MAX_SPEED = 8.0;            // 粒子最大速度上限（关键！控制整体飞行速度）
export const MOUSE_REPEL_RADIUS = 80;    // 鼠标排斥半径

// ---------- 吸引子（3个，制造粒子流动） ----------
export const ATTRACTOR_POSITIONS: [number, number, number][] = [
  [-800, 160, -300],   // 吸引子1 位置 [x, y, z]
  [360, -120, 400],    // 吸引子2 位置
  [100, 300, -200],    // 吸引子3 位置
];
export const ATTRACTOR_AXES: [number, number, number][] = [
  [0.3, 0.9, 0.1],    // 吸引子1 自旋轴方向（会自动归一化）
  [-0.5, 0.7, 0.4],   // 吸引子2 自旋轴方向
  [0.2, -0.8, 0.6],   // 吸引子3 自旋轴方向
];
export const ATTRACTOR_DRIFT_RADIUS = 150; // 吸引子漂移半径（围绕初始位置的运动范围）
export const ATTRACTOR_DRIFT_SPEED = 0.15; // 吸引子漂移速度

// ---------- 相机附近粒子减速 ----------
export const FREEZE_RADIUS = 800;        // 减速半径（距相机多少单位内粒子开始减速）
export const MIN_SPEED_RATIO = 0.03;     // 最近处粒子保留的最低速度比例（0=完全静止，1=不减速）

// ---------- 特写镜头 ----------
export const LOCK_DISTANCE = 15;         // 特写镜头时相机距智子的距离
export const FLOAT_SPEED = 0.015;        // 特写浮动动画速度
export const FLOAT_XY = 0.3;             // 特写浮动幅度（水平/垂直）
export const FLOAT_Z = 0.15;             // 特写浮动幅度（深度）
export const FLY_TO_SPEED = 0.02;        // 飞向智子的动画速度（每帧进度，越大越快）

// ---------- LOD（细节层次） ----------
export const LOD_SPHERE_COUNT = 40;      // 金属球最大实例数
export const LOD_SHOW_DIST = 150;        // 开始显示金属球的相机距离
export const LOD_FULL_DIST = 60;         // 金属球完全不透明的相机距离
export const SPHERE_RADIUS = 3;          // 金属球半径

// ---------- 辉光纹理 ----------
export const GLOW_TEXTURE_SIZE = 256;    // 辉光纹理分辨率（越大越清晰，越耗性能）
export const GLOW_CORE_RATIO = 0.15;     // 辉光核心大小比例

// ---------- 重置（O键） ----------
export const RESET_DURATION = 120;       // 重置动画帧数（60≈1秒，120≈2秒）
export const RESET_CAMERA_POS: [number, number, number] = [0, 0, 500]; // 相机初始位置

// ---------- 相机操控 ----------
export const CAMERA_RANGE = 3000;        // 相机活动范围半径（超出自动拉回）
export const CAMERA_MOVE_SPEED = 2.0;    // WASD 移动速度
export const CAMERA_ROT_SPEED = 0.02;    // 旋转速度（AD/ZX键）
export const CAMERA_BOOST = 5.0;         // 空格加速倍率
export const MOUSE_DRAG_SENSITIVITY = 0.003; // 鼠标拖拽灵敏度
