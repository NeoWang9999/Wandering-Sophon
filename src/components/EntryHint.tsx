"use client";

export default function EntryHint() {
  return (
    <div className="entry-hint fixed inset-0 z-40 pointer-events-none flex flex-col items-center justify-end pb-16">
      <div className="text-center">
        <div className="text-white/50 text-sm tracking-[0.3em] mb-3">
          流浪智子深空
        </div>
        <div className="text-white/30 text-xs tracking-widest">
          滚轮缩放 · 拖拽旋转 · 点击探索
        </div>
      </div>
    </div>
  );
}
