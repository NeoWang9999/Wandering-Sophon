"use client";

interface SophonInfo {
  index: number;
  claimed: boolean;
  nickname: string;
}

interface SophonSidebarProps {
  sophon: SophonInfo | null;
  onClose: () => void;
  onClaim: (index: number) => void;
}

export default function SophonSidebar({
  sophon,
  onClose,
  onClaim,
}: SophonSidebarProps) {
  if (!sophon) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-black/70 backdrop-blur-md border-l border-white/10 z-50 flex flex-col p-6 text-white transition-all">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/50 hover:text-white text-xl cursor-pointer"
      >
        ✕
      </button>

      <div className="mt-8">
        <div className="text-white/40 text-xs tracking-widest uppercase mb-1">
          智子编号
        </div>
        <div className="text-2xl font-light tracking-wide">
          #{String(sophon.index + 1).padStart(5, "0")}
        </div>
      </div>

      <div className="mt-6 h-px bg-white/10" />

      {sophon.claimed ? (
        <div className="mt-6 flex-1">
          <div className="text-white/40 text-xs tracking-widest uppercase mb-1">
            认领者
          </div>
          <div className="text-lg">{sophon.nickname}</div>

          <div className="mt-6 text-white/40 text-xs tracking-widest uppercase mb-1">
            蚀刻内容
          </div>
          <div className="text-sm text-white/70 leading-relaxed">
            这颗智子已被认领，蚀刻内容将在此展示。
          </div>
        </div>
      ) : (
        <div className="mt-6 flex-1 flex flex-col">
          <div className="text-white/60 text-sm leading-relaxed mb-6">
            这颗智子还在宇宙中流浪，
            <br />
            等待一个人给它归处。
          </div>

          <button
            onClick={() => onClaim(sophon.index)}
            className="mt-auto mb-8 w-full py-3 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/30 hover:border-blue-400/50 transition-all cursor-pointer text-sm tracking-wide"
          >
            认领这颗流浪智子
          </button>
        </div>
      )}
    </div>
  );
}
